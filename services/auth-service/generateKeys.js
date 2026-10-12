const crypto = require('crypto');
const fs = require('fs');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

if (!fs.existsSync('keys')) fs.mkdirSync('keys');
fs.writeFileSync('keys/private.pem', privateKey);
fs.writeFileSync('keys/public.pem', publicKey);
console.log('Keys generated successfully');
