// Смоук-тест trello-auth: подменяем эндпоинт ключей Trello своей парой RSA и гоняем сценарии.
// Запуск:  deno run -A supabase/functions/trello-auth/smoke.ts
// Сети и порта не требует: Deno.serve перехватывается, обработчик вызывается напрямую.
import * as jose from 'npm:jose@5';

const SECRET = 'test-secret-at-least-32-bytes-long-string!!';
const PROD_ORIGIN = 'https://trello-tnm-powerup.pages.dev';

// Настоящая пара — ею подписываем «токены Trello».
const real = await jose.generateKeyPair('RS256', { extractable: true });
// Посторонняя пара — чтобы проверить перебор ключей при ротации и отказ на чужой подписи.
const other = await jose.generateKeyPair('RS256', { extractable: true });
// Ключ, который Trello никогда не публиковал — он не может попасть в кэш функции.
const stranger = await jose.generateKeyPair('RS256', { extractable: true });
const realSpki = await jose.exportSPKI(real.publicKey);
const otherSpki = await jose.exportSPKI(other.publicKey);

Deno.env.set('APP_JWT_SECRET', SECRET);
Deno.env.set('TRELLO_PLUGIN_IDS', 'plugin-prod,plugin-dev');
Deno.env.set('ALLOWED_ORIGINS', `${PROD_ORIGIN},https://zelyakin.github.io`);

// Порядок важен: чужой ключ первым — функция обязана дойти до второго (сценарий ротации).
let keysResponse = { keys: [otherSpki, realSpki] };

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init: any) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.startsWith('https://api.trello.com/1/resource/jwt-public-keys')) {
        return Promise.resolve(new Response(JSON.stringify(keysResponse), {
            status: 200, headers: { 'content-type': 'application/json' }
        }));
    }
    return realFetch(input, init);
}) as typeof fetch;

let handler!: (req: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve() }; };

await import('./index.ts');

const BASE = 'http://localhost:8000';
const call = (init: RequestInit) => handler(new Request(BASE + '/', init));

async function trelloToken(over: Record<string, unknown> = {}, key = real.privateKey, exp = '5m') {
    return await new jose.SignJWT({
        idPlugin: 'plugin-prod', idBoard: '5f2b1c9e8a7d6b4c3e2f1a09', idMember: 'abc123def456abc123def456',
        ...over
    }).setProtectedHeader({ alg: 'RS256' }).setIssuer('trello')
      .setIssuedAt().setExpirationTime(exp).sign(key);
}

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failures++;
}

// 1. CORS preflight со «своего» origin
let r = await call({ method: 'OPTIONS', headers: { Origin: PROD_ORIGIN } });
check('OPTIONS: 204 + echo origin',
    r.status === 204 && r.headers.get('access-control-allow-origin') === PROD_ORIGIN,
    `status=${r.status} acao=${r.headers.get('access-control-allow-origin')}`);

// 2. CORS с чужого origin — заголовка быть не должно
r = await call({ method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
check('OPTIONS: чужой origin без ACAO', r.headers.get('access-control-allow-origin') === null);

// 3. Happy path + перебор ключей при ротации
r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: await trelloToken() }) });
const body = await r.json();
check('POST valid: 200', r.status === 200, `status=${r.status}`);

if (r.status === 200) {
    const { payload } = await jose.jwtVerify(body.token, new TextEncoder().encode(SECRET),
        { audience: 'authenticated' });
    check('минченный токен: role=authenticated', payload.role === 'authenticated');
    check('минченный токен: trello_board_id проброшен',
        payload.trello_board_id === '5f2b1c9e8a7d6b4c3e2f1a09', String(payload.trello_board_id));
    check('минченный токен: sub = idMember', payload.sub === 'abc123def456abc123def456');
    check('минченный токен: TTL ~1 час',
        Math.abs((payload.exp! - payload.iat!) - 3600) < 2, `${payload.exp! - payload.iat!}s`);
    check('минченный токен: idPlugin наружу не утёк', payload.idPlugin === undefined);
}

// 4. Чужой плагин
r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: await trelloToken({ idPlugin: 'someone-else' }) }) });
check('POST чужой idPlugin: 403', r.status === 403, `status=${r.status}`);
await r.body?.cancel();

// 5. Протухший токен Trello
r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: await trelloToken({}, real.privateKey, '-1m') }) });
check('POST протухший: 401', r.status === 401, `status=${r.status}`);
await r.body?.cancel();

// 6. Подпись ключом, которого нет среди опубликованных Trello
r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: await trelloToken({}, stranger.privateKey) }) });
check('POST неопубликованный ключ: 401', r.status === 401, `status=${r.status}`);
await r.body?.cancel();

// 6b. Осознанный компромисс: ключ, который Trello убрал из выдачи ПОСЛЕ кэширования,
// продолжает приниматься до истечения TTL кэша (4 часа). Фиксируем это как ожидаемое
// поведение, а не как случайность.
keysResponse = { keys: [realSpki] };  // otherSpki больше не публикуется, но уже в кэше
r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: await trelloToken({}, other.privateKey) }) });
check('отозванный ключ принимается до конца TTL (ожидаемо)', r.status === 200, `status=${r.status}`);
await r.body?.cancel();

// 7. Мусор вместо токена и пустое тело
r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'not-a-jwt' }) });
check('POST мусор: 401', r.status === 401, `status=${r.status}`);
await r.body?.cancel();

r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: '{}' });
check('POST без token: 400', r.status === 400, `status=${r.status}`);
await r.body?.cancel();

// 8. Токен без idBoard (теоретически невозможен, но клеймы приходят снаружи)
r = await call({ method: 'POST', headers: { Origin: PROD_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ token: await trelloToken({ idBoard: undefined }) }) });
check('POST без idBoard: 401', r.status === 401, `status=${r.status}`);
await r.body?.cancel();

console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failures}`);
Deno.exit(failures === 0 ? 0 : 1);
