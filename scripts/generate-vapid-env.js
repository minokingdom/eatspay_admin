const webPush = require('web-push');

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
const keys = webPush.generateVAPIDKeys();

console.log('# Add these lines to /opt/eatspay/.env, then run: sudo systemctl restart eatspay');
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`WEB_PUSH_VAPID_SUBJECT=${subject}`);
