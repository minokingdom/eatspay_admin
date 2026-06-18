const crypto = require('crypto');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const subject = args.subject || process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:admin@eatspay.co.kr';

function generateVapidKeys() {
  try {
    return require('web-push').generateVAPIDKeys();
  } catch (err) {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicJwk = pair.publicKey.export({ format: 'jwk' });
    const privateJwk = pair.privateKey.export({ format: 'jwk' });
    const x = Buffer.from(publicJwk.x, 'base64url');
    const y = Buffer.from(publicJwk.y, 'base64url');
    return {
      publicKey: Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url'),
      privateKey: privateJwk.d
    };
  }
}

const keys = generateVapidKeys();

console.log('# Add these lines to /opt/eatspay/.env, then run: sudo systemctl restart eatspay');
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`WEB_PUSH_VAPID_SUBJECT=${subject}`);
