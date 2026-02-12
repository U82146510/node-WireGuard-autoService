# WireGuard VPN Management Server

A Node.js-based REST API server for managing WireGuard VPN clients. This application automates the creation of WireGuard client configurations, generates QR codes for easy mobile device setup, and handles cleanup of expired clients.

## Features

- **Automated Setup**: Automatically sets up WireGuard interface, generates server keys, and configures iptables rules
- **Client Generation**: Generates unique client configurations with QR codes for easy setup
- **Device Limiting**: Each device can generate only one VPN configuration
- **Rate Limiting**: Protects against abuse with configurable rate limits
- **Automatic Cleanup**: Removes expired clients (older than 30 days) from the configuration
- **HTTPS Support**: Runs over HTTPS with self-signed certificates
- **IP Forwarding**: Enables IP forwarding for VPN functionality

## Prerequisites

- Node.js (v14 or higher)
- Linux system with root/sudo access
- WireGuard tools (`wireguard-tools`)
- QR code generator (`qrencode`)
- OpenSSL for certificate generation

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd wireguard
```

2. Install dependencies:
```bash
npm install
```

3. Run the application:
```bash
sudo node app.js
```

The application will automatically:
- Install required system packages (WireGuard, qrencode)
- Generate server keys
- Create WireGuard configuration
- Set up iptables rules
- Generate SSL certificates
- Start the HTTPS server on port 3000

## Usage

### Web Interface

The easiest way to generate VPN configurations is through the built-in web interface:

1. Start the server: `sudo node app.js`
2. Open your browser and navigate to `https://your-server:3000`
3. Click the "Give a name to be understandable by everyone" button
4. Scan the generated QR code with your WireGuard app

The web interface provides:
- One-click VPN configuration generation
- QR code display for easy mobile setup
- Downloadable config files for all devices
- Simple installation instructions for Android and iPhone
- Space for video tutorials

### API Endpoints

#### Generate Client Keys
**POST** `/generate-keys`

Generates a new WireGuard client configuration and returns a QR code.

**Authentication:** Basic Auth with Bearer token
- Username: `admin`
- Password: `123456`

**Device Limitation:** Each device can generate only one VPN configuration. Returns 429 status if limit exceeded.

**Example Request:**
```bash
curl -X POST -H "Authorization: Bearer admin:123456" \
     https://your-server:3000/generate-keys
```

**Response (Success):**
```json
{
  "qr": "base64-encoded-png-qr-code",
  "config": "wireguard-config-file-content"
}
```

**Response (Device Limit Exceeded - 429):**
```
You have already created a VPN for this device. Each device can have only one VPN configuration.
```

#### Cleanup Expired Clients
**POST** `/cleanup`

Removes clients that haven't been used in 30+ days and clears device tracking for rate limiting.

**Authentication:** Same as above

**Example Request:**
```bash
curl -X POST -H "Authorization: Bearer admin:123456" \
     https://your-server:3000/cleanup
```

**Response:**
```
Cleanup initiated. Expired clients will be removed and device tracking cleared.
```

### Client Setup

1. Make a POST request to `/generate-keys`
2. Decode the base64 QR code from the response
3. Scan the QR code with your WireGuard mobile app
4. The client will be automatically configured

## Configuration

The server uses the following default settings:
- **Port:** 3000
- **WireGuard Interface:** wg0
- **Listen Port:** 51820
- **VPN Subnet:** 10.0.0.0/22
- **Client Expiry:** 30 days
- **Rate Limit:** 10 requests per 15 minutes per IP

## Security Notes

⚠️ **Important Security Considerations:**

- This application uses basic HTTP authentication with hardcoded credentials (`admin:123456`)
- Self-signed SSL certificates are generated automatically
- For production use, implement proper authentication and use valid SSL certificates
- Consider additional security measures like firewall rules and monitoring

## Testing

Use the provided `post.js` script to test the API:

```bash
node post.js
```

This will make a test request to generate client keys.

## License

ISC License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Disclaimer

This software is provided as-is. Ensure you understand WireGuard and VPN concepts before deploying in production. Always follow security best practices.</content>
<parameter name="filePath">/home/convict/Downloads/wireguard/README.md