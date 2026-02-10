import https from 'https';
import { URL } from 'url';

async function generateWR(user, pass, link) {
  const url = new URL(link);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user}:${pass}`
    },
    rejectUnauthorized: false // Ignore self-signed certificates
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log('Raw response:', data);
        if (res.statusCode !== 200) {
          console.error(`HTTP Error: ${res.statusCode} - ${data}`);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          console.log('Response:', json);
          resolve(json);
        } catch (e) {
          console.log('Response (text):', data);
          resolve(data);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(e);
    });

    req.end();
  });
}

// Call the function with example values
generateWR('admin', '123456', 'https://209.38.105.30:3000/generate-keys').catch(console.error);
