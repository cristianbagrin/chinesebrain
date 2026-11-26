// A VAPID key pair for the evening nudge (Web Push, site/src/cbp/push.ts). Prints both halves, base64url:
//   cd site && npx wrangler secret put VAPID_PUBLIC   (paste the first)
//              npx wrangler secret put VAPID_PRIVATE  (paste the second)
// Add `--env staging` for staging. A new pair means every phone subscribes again (Settings › Habit).
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', k.publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', k.privateKey);
console.log(`VAPID_PUBLIC  ${pub}\nVAPID_PRIVATE ${d}`);
