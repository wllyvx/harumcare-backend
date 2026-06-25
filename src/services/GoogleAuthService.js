/**
 * Service for Google OAuth verification
 */
export class GoogleAuthService {
    /**
     * Verifies a Google ID token
     * @param {string} credential - The JWT from Google
     * @param {string} googleClientId - The client ID to verify against
     * @returns {Promise<Object>} - Verified user data
     */
    static async verifyToken(credential, googleClientId) {
        try {
            // Decode the JWT header to get the key ID (kid)
            const parts = credential.split('.');
            if (parts.length !== 3) throw new Error('Invalid token format');

            const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

            // Verify basic claims
            if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
                throw new Error('Invalid issuer');
            }
            if (payload.aud !== googleClientId) {
                throw new Error('Invalid audience');
            }
            if (payload.exp < Math.floor(Date.now() / 1000)) {
                throw new Error('Token expired');
            }

            // Fetch Google's public keys and verify signature
            // NOTE: Ideally this response should be cached
            const certsResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
            const certs = await certsResponse.json();
            const key = certs.keys.find(k => k.kid === header.kid);
            if (!key) throw new Error('Key not found');

            // Import the public key
            const cryptoKey = await crypto.subtle.importKey(
                'jwk',
                key,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify']
            );

            // Verify the signature
            const signatureBytes = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
            const dataBytes = new TextEncoder().encode(parts[0] + '.' + parts[1]);

            const valid = await crypto.subtle.verify(
                'RSASSA-PKCS1-v1_5',
                cryptoKey,
                signatureBytes,
                dataBytes
            );

            if (!valid) throw new Error('Invalid signature');

            return {
                sub: payload.sub,
                email: payload.email,
                name: payload.name || payload.email.split('@')[0],
                picture: payload.picture
            };
        } catch (error) {
            console.error('Google token verification error:', error);
            throw new Error('Invalid Google token: ' + error.message);
        }
    }
}
