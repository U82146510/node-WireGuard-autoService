import express from 'express';
import https from 'https';
import { exec } from 'child_process';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { promisify } from 'util';

const app = express();
const port = 3000;
const execAsync = promisify(exec);

// Cleanup function to remove expired clients (older than 30 days)
function cleanupExpiredClients() {
  const expiryDays = 30;
  const expiryMs = expiryDays * 24 * 60 * 60 * 1000;

  fs.readFile('/etc/wireguard/wg0.conf', 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading wg0.conf for cleanup:', err);
      return;
    }

    const lines = data.split('\n');
    const newLines = [];
    let skipPeer = false;
    const peersToRemove = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('[Peer]')) {
        skipPeer = false;
      } else if (line.startsWith('# Created:')) {
        const timestamp = parseInt(line.split(':')[1].trim());
        if (Date.now() - timestamp > expiryMs) {
          skipPeer = true;
          // Find public key
          for (let j = i + 1; j < lines.length && !lines[j].startsWith('['); j++) {
            if (lines[j].startsWith('PublicKey = ')) {
              const pubKey = lines[j].split('=')[1].trim();
              peersToRemove.push(pubKey);
              break;
            }
          }
        }
      } else if (line.startsWith('[') && skipPeer) {
        skipPeer = false;
      }

      if (!skipPeer) {
        newLines.push(line);
      }
    }

    const newData = newLines.join('\n');
    if (newData !== data) {
      fs.writeFile('/etc/wireguard/wg0.conf', newData, (err) => {
        if (!err) {
          console.log('Expired clients removed from wg0.conf');
          // Remove peers from running interface without restart
          peersToRemove.forEach(pubKey => {
            exec(`wg set wg0 peer ${pubKey} remove`, (error) => {
              if (error) {
                console.error(`Error removing peer ${pubKey}:`, error);
              } else {
                console.log(`Peer ${pubKey} removed from running interface`);
              }
            });
          });
        }
      });
    }
  });
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to the generate-keys route
app.use('/generate-keys', limiter);

// Setup function to run once at startup
async function setupWireGuard() {
  try {
    // Ensure WireGuard and qrencode are installed
    await execAsync('which wg qrencode || (sudo apt update && sudo apt install -y wireguard-tools qrencode)');

    // Enable IP forwarding
    await execAsync('sysctl -w net.ipv4.ip_forward=1 && grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf || echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf');

    // Check if server keys exist, generate if not
    await execAsync('test -f /etc/wireguard/server_private.key || (wg genkey > /etc/wireguard/server_private.key && wg pubkey < /etc/wireguard/server_private.key > /etc/wireguard/server_public.key)');

    // Check if wg0.conf exists, create if not
    try {
      await fs.promises.access('/etc/wireguard/wg0.conf');
    } catch (err) {
      // Get the default network interface
      const { stdout: iface } = await execAsync('ip route | grep default | awk \'{print $5}\'');
      const interfaceName = iface.trim();

      // Create wg0.conf
      const priv = await fs.promises.readFile('/etc/wireguard/server_private.key', 'utf8');
      const conf = `[Interface]
PrivateKey = ${priv.trim()}
ListenPort = 51820
Address = 10.0.0.1/22
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${interfaceName} -j MASQUERADE
PreDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${interfaceName} -j MASQUERADE
`;
      await fs.promises.writeFile('/etc/wireguard/wg0.conf', conf);
    }

    // Generate SSL certificates if not exist
    await execAsync('test -f certs/cert.pem || (mkdir -p certs && openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost")');

    // Bring up the WireGuard interface
    await execAsync('wg-quick up wg0');
  } catch (error) {
    throw new Error('Error in setup: ' + error.message);
  }
}

app.post('/generate-keys', (req, res) => {
  // Simple authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', 'Bearer realm="WireGuard API"');
    return res.status(401).send('Authentication required');
  }
  const credentials = authHeader.split(' ')[1];
  const [username, password] = credentials.split(':');
  if (username !== 'admin' || password !== '123456') {
    return res.status(401).send('Invalid credentials');
  }

  proceedToGenerateClient(res);
});

app.post('/cleanup', (req, res) => {
  // Simple authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.set('WWW-Authenticate', 'Bearer realm="WireGuard API"');
    return res.status(401).send('Authentication required');
  }
  const credentials = authHeader.split(' ')[1];
  const [username, password] = credentials.split(':');
  if (username !== 'admin' || password !== '123456') {
    return res.status(401).send('Invalid credentials');
  }

  cleanupExpiredClients();
  res.send('Cleanup initiated. Expired clients will be removed.');
});

function proceedToGenerateClient(res) {
  (async () => {
    try {
      const files = await fs.promises.readdir('/etc/wireguard');

      // Find existing client private files (ending with .conf)
      const privateFiles = files.filter(file => /^client_private(\d*)\.conf$/.test(file));
      // Find existing client public files (ending with .key)
      const publicFiles = files.filter(file => /^client_public(\d*)\.key$/.test(file));

      // Extract numbers from private files
      const privateNums = privateFiles.map(file => {
        const match = file.match(/^client_private(\d*)\.conf$/);
        return match[1] ? parseInt(match[1]) : 0;
      });

      // Extract numbers from public files
      const publicNums = publicFiles.map(file => {
        const match = file.match(/^client_public(\d*)\.key$/);
        return match[1] ? parseInt(match[1]) : 0;
      });

      // Find the maximum number
      const maxPrivate = Math.max(-1, ...privateNums);
      const maxPublic = Math.max(-1, ...publicNums);
      const nextNum = Math.max(maxPrivate, maxPublic) + 1;

      // Check max clients limit
      if (nextNum >= 400) {
        return res.status(400).send('Max clients (400) reached');
      }

      // Determine file names
      let privateKeyFile, publicKeyFile;
      if (nextNum === 0) {
        privateKeyFile = 'client_private.conf';
        publicKeyFile = 'client_public.key';
      } else {
        privateKeyFile = `client_private${nextNum}.conf`;
        publicKeyFile = `client_public${nextNum}.key`;
      }

      // Generate keys
      await execAsync(`wg genkey > /etc/wireguard/${privateKeyFile} && wg pubkey < /etc/wireguard/${privateKeyFile} > /etc/wireguard/${publicKeyFile}`);

      // Read client public key
      const pubKey = await fs.promises.readFile(`/etc/wireguard/${publicKeyFile}`, 'utf8');

      // Read wg0.conf and add peer
      const conf = await fs.promises.readFile('/etc/wireguard/wg0.conf', 'utf8');

      const clientIPNum = nextNum + 2; // 2 for first client
      const peerSection = `
# Created: ${Date.now()}
[Peer]
PublicKey = ${pubKey.trim()}
AllowedIPs = 10.0.0.${clientIPNum}/32
`;
      const newConf = conf + peerSection;
      await fs.promises.writeFile('/etc/wireguard/wg0.conf', newConf);

      // Add peer to running interface without restart
      await execAsync(`wg set wg0 peer ${pubKey.trim()} allowed-ips 10.0.0.${clientIPNum}/32`);

      // Generate client config
      const privKey = await fs.promises.readFile(`/etc/wireguard/${privateKeyFile}`, 'utf8');

      const serverPub = await fs.promises.readFile('/etc/wireguard/server_public.key', 'utf8');

      const clientConfig = `[Interface]
PrivateKey = ${privKey.trim()}
Address = 10.0.0.${clientIPNum}/22

[Peer]
PublicKey = ${serverPub.trim()}
Endpoint = 127.0.0.1:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

      const escapedConfig = clientConfig.replace(/'/g, "'\\''");
      const { stdout } = await execAsync(`echo "${escapedConfig}" | qrencode -o - -t PNG | base64 -w 0`);

      // Delete key files after use
      await fs.promises.unlink(`/etc/wireguard/${privateKeyFile}`);
      await fs.promises.unlink(`/etc/wireguard/${publicKeyFile}`);

      res.json({ qr: stdout }); // Send base64 encoded PNG in JSON
    } catch (error) {
      console.error(`Error generating client: ${error}`);
      res.status(500).send('Error generating client');
    }
  })();
}

// Start the app after setup
(async () => {
  try {
    console.log('Setting up WireGuard...');
    await setupWireGuard();
    console.log('WireGuard setup complete.');

    // Cleanup expired clients
    cleanupExpiredClients();

    // Get public IP
    exec('curl -s ifconfig.me', (error, stdout) => {
      const publicIP = error ? 'localhost' : stdout.trim();
      const options = {
        key: fs.readFileSync('certs/key.pem'),
        cert: fs.readFileSync('certs/cert.pem')
      };
      https.createServer(options, app).listen(port, () => {
        console.log(`WireGuard app listening at https://${publicIP}:${port}`);
      });
    });
  } catch (error) {
    console.error('Failed to setup WireGuard:', error.message);
    process.exit(1);
  }
})();