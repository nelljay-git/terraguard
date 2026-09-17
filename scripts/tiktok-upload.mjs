// TikTok Content Posting API uploader (Direct Post + inbox drafts).
// Designed for the free pipeline: runs in GitHub Actions after
// scripts/video-entry.ts produces the MP4.
//
// Env:
//   TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET (TikTok app credentials)
//   TIKTOK_REFRESH_TOKEN (long-lived; ROTATES — see below)
//   TIKTOK_MODE: "draft" (default, video.upload -> creator inbox, works
//     pre-audit) or "direct" (video.publish -> profile; stays SELF_ONLY
//     until your app passes TikTok's content audit)
//   MP4: path to the video file (default video-out/tiktok.mp4)
//   QUAKE_JSON: quake fields for the auto-built title (optional)
//   TITLE: explicit caption (overrides the auto-built one, max ~2200 chars)
//   GH_SECRETS_PAT: fine-grained PAT with Secrets read/write on this repo.
//     Used ONLY to persist a rotated refresh token back to the
//     TIKTOK_REFRESH_TOKEN secret so automation never dies. Without it,
//     a rotated token is only logged as a loud warning.
//   GH_REPO: "owner/repo" (needed for the write-back above)
//   DRY_RUN=1: print the planned API calls without sending anything.
//
// Token rotation is real: TikTok returns a NEW refresh_token on refresh
// ("always replace"). The script writes it back to the repo secret when
// it can; otherwise it warns loudly.

import { pathToFileURL } from 'node:url';

const API = 'https://open.tiktokapis.com';

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function apiJson(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error && data.error.code !== 'ok')) {
    const code = data.error?.code ?? 'no-code';
    let hint = '';
    if (code === 'scope_not_authorized') {
      hint = ' FIX: re-run the TikTok authorize URL WITH video.upload (and video.publish if needed) in scope, exchange for a new refresh token, and update the TIKTOK_REFRESH_TOKEN secret. Tokens minted before a scope was added never gain it.';
    } else if (code === 'access_token_invalid') {
      hint = ' FIX: token expired or revoked — refresh pair is stale, redo the OAuth dance for a fresh refresh token.';
    }
    throw new Error(`${method} ${path} failed: ${data.error?.message ?? res.status} (${code}).${hint}`);
  }
  return data.data ?? data;
}

async function refreshAccessToken(clientKey, clientSecret, refreshToken) {
  const { res, data } = await postForm(`${API}/v2/oauth/token/`, {
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (!res.ok || !data.access_token) {
    // Token endpoint uses OAuth shapes ({error, error_description, log_id})
    // while API endpoints use {error:{code,message,log_id}} — surface both
    // so the next failure names its real cause instead of just "200".
    const reason = data.error_description ?? data.error?.message ?? res.status;
    const code = typeof data.error === 'string' ? data.error : (data.error?.code ?? 'none');
    const logId = data.log_id ?? data.error?.log_id ?? 'none';
    throw new Error(`token refresh failed: ${reason} (code=${code}, log_id=${logId}) — re-run Login Kit to get a fresh pair`);
  }
  return data;
}

// Persist a rotated refresh token to the repo secret (libsodium sealed box,
// same construction GitHub uses). Best-effort: warns loudly on failure.
async function writeBackRefreshToken({ pat, repo, name, value }) {
  const sodium = await import('libsodium-wrappers');
  await sodium.ready;
  const keyRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'User-Agent': 'TerraGuard-TikTok/1.0' },
  });
  if (!keyRes.ok) throw new Error(`public-key HTTP ${keyRes.status} (PAT needs Secrets read/write on ${repo})`);
  const { key, key_id } = await keyRes.json();
  const sealed = sodium.crypto_box_seal(
    Buffer.from(value, 'utf8'),
    Buffer.from(key, 'base64'),
  );
  const put = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json', 'User-Agent': 'TerraGuard-TikTok/1.0' },
    body: JSON.stringify({ encrypted_value: Buffer.from(sealed).toString('base64'), key_id }),
  });
  if (put.status !== 201 && put.status !== 204) throw new Error(`secret update HTTP ${put.status}`);
}

async function uploadChunks(uploadUrl, fileBytes, chunkSize = 10 * 1024 * 1024) {
  const total = fileBytes.length;
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + chunkSize, total);
    const chunk = fileBytes.subarray(offset, end);
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
      },
      body: chunk,
    });
    // TikTok answers 201/206 per chunk; drain body before next PUT.
    await res.arrayBuffer().catch(() => null);
    if (![200, 201, 206].includes(res.status)) {
      throw new Error(`chunk upload HTTP ${res.status} at byte ${offset}`);
    }
    offset = end;
  }
}

function buildTitle(quake) {
  const mag = quake.magnitude || '?';
  const place = quake.place || quake.location || '';
  const { date, time } = (() => {
    const m = /^(.*?)\s*-\s*(.+)$/.exec(String(quake.datetime ?? '').trim());
    return m ? { date: m[1].trim(), time: m[2].trim() } : { date: '', time: '' };
  })();
  return `M${mag} Earthquake${place ? ` - ${place}` : ''}${date ? ` | ${date}` : ''}${time ? ` ${time}` : ''} | TerraGuard #Earthquake #TerraGuardPH`;
}

async function main() {
  const dry = process.env.DRY_RUN === '1';
  const mode = (process.env.TIKTOK_MODE || 'draft').toLowerCase() === 'direct' ? 'direct' : 'draft';
  const mp4Path = process.env.MP4 || 'video-out/tiktok.mp4';
  // Quake fields: inline JSON preferred, else the quake.json file the
  // render step always writes (avoids re-deriving manual inputs here).
  const fs = await import('node:fs');
  let quakeRaw = process.env.QUAKE_JSON || '';
  if ((!quakeRaw || quakeRaw === 'null') && process.env.QUAKE_FILE) {
    try {
      quakeRaw = fs.readFileSync(process.env.QUAKE_FILE, 'utf8');
    } catch {
      /* fall through to {} */
    }
  }
  const quake = JSON.parse(quakeRaw || '{}');
  const title = (process.env.TITLE || '').slice(0, 2200) || buildTitle(quake);
  console.log(`mode=${mode} mp4=${mp4Path}`);

  const clientKey = (process.env.TIKTOK_CLIENT_KEY || '').trim();
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || '').trim();
  let refreshToken = (process.env.TIKTOK_REFRESH_TOKEN || '').trim();
  if (!clientKey || !clientSecret || !refreshToken) {
    // No credentials (e.g. secrets not set yet): skip green so the video
    // pipeline stays green. The workflow `if:` gate can't read secrets.
    console.log('TikTok creds not set — skipping upload (MP4 artifact still kept).');
    return;
  }

  if (!fs.existsSync(mp4Path)) throw new Error(`MP4 not found: ${mp4Path}`);
  const size = fs.statSync(mp4Path).size;
  console.log(`video bytes: ${size}`);
  // TikTok chunk rules (Media Transfer Guide): each chunk 5–64MB, count =
  // floor(size/chunk), last chunk absorbs the remainder; videos < 5MB go
  // whole with chunk_size = video_size. Our renders (~2MB) always take
  // the single-chunk path; the branch below keeps bigger files valid too.
  const MIN_CHUNK = 5 * 1024 * 1024;
  let chunkSize = 10 * 1024 * 1024;
  let totalChunks = Math.floor(size / chunkSize);
  if (size < MIN_CHUNK || totalChunks < 1) {
    chunkSize = size;
    totalChunks = 1;
  }
  console.log(`chunks: ${totalChunks} x ${chunkSize} bytes`);

  // 1. Fresh access token (24h life) + capture rotation.
  console.log('refreshing access token…');
  const tokens = dry ? { access_token: 'DRY', open_id: 'DRY' } : await refreshAccessToken(clientKey, clientSecret, refreshToken);
  const accessToken = tokens.access_token;
  if (!dry && tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    console.log('refresh token rotated — persisting back to repo secret…');
    const pat = process.env.GH_SECRETS_PAT || '';
    const repo = process.env.GH_REPO || '';
    if (pat && repo.includes('/')) {
      try {
        await writeBackRefreshToken({ pat, repo, name: 'TIKTOK_REFRESH_TOKEN', value: tokens.refresh_token });
        console.log('rotated refresh token saved.');
      } catch (e) {
        console.log(`::warning::ROTATED REFRESH TOKEN NOT SAVED (${e instanceof Error ? e.message : e}). Automation WILL break — update TIKTOK_REFRESH_TOKEN manually to: ${tokens.refresh_token.slice(0, 12)}…`);
      }
    } else {
      console.log(`::warning::ROTATED REFRESH TOKEN NOT SAVED (no GH_SECRETS_PAT). Update TIKTOK_REFRESH_TOKEN manually soon or automation WILL break. New prefix: ${tokens.refresh_token.slice(0, 12)}…`);
    }
  }

  // 2. Creator info (validates token/scopes; draft mode still calls it).
  console.log('querying creator info…');
  // 2. Creator info. REQUIRED for direct post (video.publish scope), but
  // the inbox draft flow never needs it — TikTok's own upload guide goes
  // straight to init, and our draft path only logs these fields. So in
  // draft mode a failure is a warning, not fatal (e.g. token carries
  // video.upload but not video.publish).
  let creator = { creator_username: '?', privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 };
  if (dry) {
    creator = { creator_username: 'DRY', privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 600 };
  } else if (mode === 'direct') {
    creator = await apiJson('POST', '/v2/post/publish/creator_info/query/', accessToken, {});
  } else {
    try {
      creator = await apiJson('POST', '/v2/post/publish/creator_info/query/', accessToken, {});
    } catch (e) {
      console.log(`::warning::creator info unavailable in draft mode (${e instanceof Error ? e.message : e}) — continuing to inbox init.`);
    }
  }
  console.log('creator:', creator.creator_username, '| privacy options:', (creator.privacy_level_options || []).join(','));

  // 3. Init (inbox draft vs direct post).
  const initPath = mode === 'direct' ? '/v2/post/publish/video/init/' : '/v2/post/publish/inbox/video/init/';
  const postInfo = { title };
  if (mode === 'direct') {
    const options = creator.privacy_level_options || ['SELF_ONLY'];
    postInfo.privacy_level = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0];
    console.log('direct privacy_level:', postInfo.privacy_level, options.includes('PUBLIC_TO_EVERYONE') ? '' : '(app unaudited: expect SELF_ONLY)');
  }
  console.log(`init ${mode}…`);
  const init = dry
    ? { publish_id: 'DRY', upload_url: 'DRY' }
    : await apiJson('POST', initPath, accessToken, {
        post_info: postInfo,
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks },
      });
  console.log('publish_id:', init.publish_id);

  // 4. Chunked upload (same chunkSize declared at init; the final slice
  // absorbs any remainder).
  if (!dry) {
    const { readFile } = await import('node:fs/promises');
    const bytes = new Uint8Array(await readFile(mp4Path));
    console.log(`uploading ${totalChunks} chunk(s)…`);
    await uploadChunks(init.upload_url, bytes, chunkSize);
  } else {
    console.log(`DRY RUN: would upload ${size} bytes in ${totalChunks} chunk(s) to <upload_url>, title: ${title.slice(0, 80)}`);
  }

  // 5. Status check (informational — the chunks are already on TikTok's
  // servers at this point, so in draft mode a failure warns, not kills).
  if (!dry) {
    try {
      const status = await apiJson('POST', '/v2/post/publish/status/fetch/', accessToken, { publish_id: init.publish_id });
      console.log('publish status:', JSON.stringify(status).slice(0, 300));
    } catch (e) {
      if (mode === 'direct') throw e;
      console.log(`::warning::status check failed (${e instanceof Error ? e.message : e}) — upload itself completed.`);
    }
  }
  console.log(mode === 'draft' ? 'DONE: video is in the creator inbox — finish posting inside the TikTok app.' : 'DONE: direct post submitted.');
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
