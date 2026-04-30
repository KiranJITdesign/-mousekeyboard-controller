const { execSync } = require('child_process');
const fs = require('fs');

function generateCert() {
  console.log('Generating self-signed certificate for HTTPS...');

  try {
    // Try PowerShell first (Windows)
    const psCmd = `
      $cert = New-SelfSignedCertificate -DnsName @("localhost") -CertStoreLocation "cert:\\CurrentUser\\My" -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(1)
      $pwd = ConvertTo-SecureString -String "trackpad" -Force -AsPlainText
      Export-PfxCertificate -Cert $cert -FilePath cert.pfx -Password $pwd
    `;
    execSync(psCmd, { shell: 'powershell.exe', stdio: 'inherit' });

    // Extract key and cert from PFX using OpenSSL
    try {
      execSync('openssl pkcs12 -in cert.pfx -nocerts -nodes -passin pass:trackpad -out key.pem', { stdio: 'inherit' });
      execSync('openssl pkcs12 -in cert.pfx -nokeys -nodes -passin pass:trackpad -out cert.pem', { stdio: 'inherit' });
      fs.unlinkSync('cert.pfx');
      console.log('Certificate generated successfully!');
      console.log('Files created: key.pem, cert.pem');
      console.log('Restart the server to enable HTTPS.');
    } catch (opensslErr) {
      console.log('OpenSSL not available for extracting cert.');
      console.log('Your system has cert.pfx but needs OpenSSL to convert it.');
      console.log('Install OpenSSL or Git for Windows, then run:');
      console.log('  openssl pkcs12 -in cert.pfx -nocerts -nodes -passin pass:trackpad -out key.pem');
      console.log('  openssl pkcs12 -in cert.pfx -nokeys -nodes -passin pass:trackpad -out cert.pem');
    }
  } catch (err) {
    console.error('Failed to generate certificate:', err.message);
    console.log('You may need to run this as Administrator.');
  }
}

if (fs.existsSync('key.pem') && fs.existsSync('cert.pem')) {
  console.log('Certificate files already exist.');
  console.log('To regenerate, delete key.pem and cert.pem, then run this script again.');
} else {
  generateCert();
}

