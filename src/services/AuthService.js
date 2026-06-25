import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/**
 * Service for Authentication logic
 */
export class AuthService {
    /**
     * Hashes a password
     * @param {string} password 
     * @returns {Promise<string>}
     */
    static async hashPassword(password) {
        return await bcrypt.hash(password, 10);
    }

    /**
     * Compares a password with a hash
     * @param {string} password 
     * @param {string} hash 
     * @returns {Promise<boolean>}
     */
    static async comparePassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    /**
     * Generates a JWT token
     * @param {Object} payload 
     * @param {string} secret 
     * @param {string} expiresIn 
     * @returns {string}
     */
    static generateToken(payload, secret, expiresIn = '24h') {
        if (!secret) {
            throw new Error('JWT Secret is required for token generation');
        }
        return jwt.sign(payload, secret, { expiresIn });
    }

    /**
     * Verifies a JWT token
     * @param {string} token 
     * @param {string} secret 
     * @returns {Object}
     */
    static verifyToken(token, secret) {
        if (!secret) {
            throw new Error('JWT Secret is required for token verification');
        }
        return jwt.verify(token, secret);
    }
}
