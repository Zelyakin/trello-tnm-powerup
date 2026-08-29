// supabase/functions/trello-auth/index.ts
//
// Обмен подписанного Trello JWT на короткоживущий Supabase-токен, привязанный к доске.
//
// Зачем: anon-ключ статичен и одинаков для всех — он не доказывает, на какой доске открыт
// Power-Up. Trello же выдаёт через t.jwt() токен, подписанный своим приватным ключом (RS256),
// с клеймами idPlugin/idBoard/idMember. Проверив эту подпись на сервере, мы можем выпустить
// собственный токен с клеймом trello_board_id, по которому режут доступ политики RLS.
//
// Функция деплоится с verify_jwt = false (см. ../config.toml): на входе у клиента есть только
// токен Trello, супабейсовского JWT ещё нет. Открытой дырой это не делает — без валидной
// подписи Trello функция ничего не выдаёт.

import * as jose from 'npm:jose@5';

// --- Конфигурация из секретов проекта -------------------------------------------------------
// Префикс SUPABASE_ зарезервирован платформой, поэтому секрет называется APP_JWT_SECRET.
const APP_JWT_SECRET = Deno.env.get('APP_JWT_SECRET');
// ID обоих Power-Up'ов (прод и дев) через запятую — иначе функция примет токен чужого плагина.
const ALLOWED_PLUGIN_IDS = (Deno.env.get('TRELLO_PLUGIN_IDS') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
// Origin'ы обоих деплоев Power-Up'а через запятую.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);

const TRELLO_KEYS_URL = 'https://api.trello.com/1/resource/jwt-public-keys';
const KEYS_TTL_MS = 4 * 60 * 60 * 1000; // 4 часа
const TOKEN_TTL_SEC = 60 * 60;          // 1 час

// --- Кэш публичных ключей Trello ------------------------------------------------------------
// Живёт в module scope: переживает вызовы в пределах одного инстанса функции.
let _keysCache: { keys: jose.KeyLike[]; timestamp: number } | null = null;

async function getTrelloKeys(): Promise<jose.KeyLike[]> {
    if (_keysCache && Date.now() - _keysCache.timestamp < KEYS_TTL_MS) {
        return _keysCache.keys;
    }

    const response = await fetch(TRELLO_KEYS_URL);
    if (!response.ok) {
        throw new Error(`Trello keys fetch failed: ${response.status}`);
    }

    // Формат ответа: { "keys": ["-----BEGIN PUBLIC KEY-----\n...", ...] }
    // Это НЕ JWKS: голые PEM без kid. Ключей может быть несколько — Trello публикует новый
    // заранее, до ротации приватного, чтобы не ломать интеграции.
    const body = await response.json();
    const pems: string[] = Array.isArray(body?.keys) ? body.keys : [];
    if (pems.length === 0) {
        throw new Error('Trello keys response contains no keys');
    }

    const keys = await Promise.all(pems.map((pem) => jose.importSPKI(pem, 'RS256')));
    _keysCache = { keys, timestamp: Date.now() };
    return keys;
}

// Пробуем каждый ключ по очереди: успех на любом = валидная подпись.
async function verifyTrelloToken(token: string) {
    const keys = await getTrelloKeys();
    let lastError: unknown = null;

    for (const key of keys) {
        try {
            // jose сам проверит exp/iat и сверит issuer.
            const { payload } = await jose.jwtVerify(token, key, { issuer: 'trello' });
            return payload;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError ?? new Error('No Trello key matched');
}

// --- CORS -----------------------------------------------------------------------------------
function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '3600',
        'Vary': 'Origin'
    };
    // Эхо только для известных origin'ов — без '*', чтобы не отвечать кому попало.
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
}

// --- Обработчик -----------------------------------------------------------------------------
Deno.serve(async (req) => {
    const origin = req.headers.get('Origin');

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, origin);
    }

    // Конфигурация обязательна вся: без неё функция не должна работать «наполовину».
    if (!APP_JWT_SECRET || ALLOWED_PLUGIN_IDS.length === 0 || ALLOWED_ORIGINS.length === 0) {
        console.error('Function is misconfigured: missing secret / plugin ids / origins');
        return json({ error: 'server_misconfigured' }, 500, origin);
    }

    let trelloToken: string | undefined;
    try {
        const body = await req.json();
        trelloToken = body?.token;
    } catch {
        return json({ error: 'invalid_body' }, 400, origin);
    }
    if (typeof trelloToken !== 'string' || trelloToken.length === 0) {
        return json({ error: 'token_required' }, 400, origin);
    }

    // 1. Подпись Trello
    let claims: jose.JWTPayload;
    try {
        claims = await verifyTrelloToken(trelloToken);
    } catch (error) {
        // Сам токен в лог не пишем.
        console.warn('Trello token verification failed:', (error as Error)?.message);
        return json({ error: 'invalid_trello_token' }, 401, origin);
    }

    // 2. Наш ли это плагин
    const idPlugin = claims.idPlugin as string | undefined;
    const idBoard = claims.idBoard as string | undefined;
    const idMember = claims.idMember as string | undefined;

    if (!idPlugin || !ALLOWED_PLUGIN_IDS.includes(idPlugin)) {
        console.warn('Rejected token from unknown plugin:', idPlugin);
        return json({ error: 'unknown_plugin' }, 403, origin);
    }
    if (!idBoard || !idMember) {
        return json({ error: 'incomplete_claims' }, 401, origin);
    }

    // 3. Выпуск собственного токена
    // role обязан совпадать с существующей ролью Postgres — отсюда 'authenticated'.
    // ВНИМАНИЕ: sub здесь — 24-символьный id участника Trello, а не UUID. Значит auth.uid()
    // в политиках использовать нельзя (упадёт на приведении типа) — только auth.jwt()->>'...'.
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TOKEN_TTL_SEC;

    const token = await new jose.SignJWT({
        role: 'authenticated',
        trello_board_id: idBoard,
        trello_member_id: idMember
    })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(idMember)
        .setAudience('authenticated')
        .setIssuedAt(now)
        .setExpirationTime(expiresAt)
        .sign(new TextEncoder().encode(APP_JWT_SECRET));

    return json({ token, expiresAt }, 200, origin);
});
