// Minimal local certificate authority for the block page (no dependencies).
// Builds DER-encoded X.509 v3 certificates with EC P-256 keys and ECDSA-SHA256.
// The CA key is created on this PC; leaf certificates are issued in memory only.
const crypto=require('node:crypto');

const len=n=>n<0x80?Buffer.from([n]):n<0x100?Buffer.from([0x81,n]):Buffer.from([0x82,n>>8,n&0xff]);
const tlv=(tag,...parts)=>{const body=Buffer.concat(parts.flat());return Buffer.concat([Buffer.from([tag]),len(body.length),body]);};
const seq=(...p)=>tlv(0x30,...p);
const set=(...p)=>tlv(0x31,...p);
const bool=b=>tlv(0x01,Buffer.from([b?0xff:0]));
const octet=b=>tlv(0x04,b);
const utf8=s=>tlv(0x0c,Buffer.from(s,'utf8'));
function int(value) {
  let b=Buffer.isBuffer(value)?value:Buffer.from([value]);
  while(b.length>1 && b[0]===0 && !(b[1]&0x80))b=b.subarray(1);
  if(b[0]&0x80)b=Buffer.concat([Buffer.from([0]),b]);
  return tlv(0x02,b);
}
function oid(text) {
  const p=text.split('.').map(Number);const out=[40*p[0]+p[1]];
  for(const n of p.slice(2)){const bytes=[];let v=n;do{bytes.unshift(v&0x7f);v=Math.floor(v/128);}while(v);for(let i=0;i<bytes.length-1;i++)bytes[i]|=0x80;out.push(...bytes);}
  return tlv(0x06,Buffer.from(out));
}
function time(date) {
  const pad=n=>String(n).padStart(2,'0');
  const y=date.getUTCFullYear();
  const body=`${pad(date.getUTCMonth()+1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return y<2050?tlv(0x17,Buffer.from(String(y).slice(2)+body)):tlv(0x18,Buffer.from(String(y)+body));
}
const name=(cn)=>seq(set(seq(oid('2.5.4.10'),utf8('Leise DNS'))),set(seq(oid('2.5.4.3'),utf8(cn))));
const ext=(id,critical,value)=>seq(oid(id),...(critical?[bool(true)]:[]),octet(value));
const ECDSA_SHA256=seq(oid('1.2.840.10045.4.3.2'));
const keyId=publicKey=>crypto.createHash('sha1').update(publicKey.export({type:'spki',format:'der'})).digest();

function certificate({subject,issuer,publicKey,signingKey,days,extensions}) {
  const serial=crypto.randomBytes(16);serial[0]&=0x7f;serial[0]|=0x01;
  const notBefore=new Date(Date.now()-3600000);const notAfter=new Date(Date.now()+days*86400000);
  const tbs=seq(tlv(0xa0,int(2)),int(serial),ECDSA_SHA256,issuer,seq(time(notBefore),time(notAfter)),subject,
    publicKey.export({type:'spki',format:'der'}),tlv(0xa3,seq(...extensions)));
  const signature=crypto.sign('sha256',tbs,signingKey);
  return seq(tbs,ECDSA_SHA256,tlv(0x03,Buffer.from([0]),signature));
}
const pem=der=>`-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
const CA_NAME='Leise DNS Sperrseite (nur dieser PC)';

class LocalCA {
  // Creates a new CA. Valid for two years; renewing requires a new Windows confirmation.
  static create() {
    const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
    const id=keyId(publicKey);
    const der=certificate({subject:name(CA_NAME),issuer:name(CA_NAME),publicKey,signingKey:privateKey,days:730,extensions:[
      ext('2.5.29.19',true,seq(bool(true),int(0))),            // CA, no sub-CAs
      ext('2.5.29.15',true,tlv(0x03,Buffer.from([1,0x06]))),    // keyCertSign, cRLSign
      // Windows chains EKUs: a leaked key can then only issue web server certificates,
      // never code-signing or e-mail certificates.
      ext('2.5.29.37',false,seq(oid('1.3.6.1.5.5.7.3.1'))),     // serverAuth only
      ext('2.5.29.14',false,octet(id))
    ]});
    return new LocalCA(der,privateKey);
  }
  static load({cert,key}) {return new LocalCA(Buffer.from(cert,'base64'),crypto.createPrivateKey(key));}
  constructor(der,privateKey) {
    this.der=der;this.key=privateKey;this.x509=new crypto.X509Certificate(der);
    this.pem=pem(der);this.thumbprint=this.x509.fingerprint.replace(/:/g,'');
    this.leafKey=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
  }
  get expires() {return new Date(this.x509.validTo).getTime();}
  export() {return {cert:this.der.toString('base64'),key:this.key.export({type:'pkcs8',format:'pem'})};}
  // Short-lived certificate for exactly one blocked host name.
  issue(domain) {
    if(!/^[a-z0-9.-]{1,253}$/.test(domain))throw new Error('Ungültiger Domainname.');
    const caId=keyId(this.x509.publicKey);
    const der=certificate({subject:seq(set(seq(oid('2.5.4.3'),utf8(domain)))),issuer:name(CA_NAME),publicKey:this.leafKey.publicKey,signingKey:this.key,days:7,extensions:[
      ext('2.5.29.19',false,seq()),
      ext('2.5.29.15',true,tlv(0x03,Buffer.from([7,0x80]))),    // digitalSignature
      ext('2.5.29.37',false,seq(oid('1.3.6.1.5.5.7.3.1'))),     // serverAuth
      ext('2.5.29.17',false,seq(tlv(0x82,Buffer.from(domain)))),
      ext('2.5.29.35',false,seq(tlv(0x80,caId)))
    ]});
    return {cert:pem(der)+this.pem,key:this.leafKey.privateKey.export({type:'pkcs8',format:'pem'})};
  }
}
module.exports={LocalCA,CA_NAME};
