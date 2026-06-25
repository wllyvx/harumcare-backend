import jwt from 'jsonwebtoken';

export const authenticateToken = async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return c.json({ error: 'Access denied: No token provided' }, 401);
    }

    try {
        const secret = c.env.JWT_SECRET;
        if (!secret) {
            console.error('JWT_SECRET is not defined in environment');
            return c.json({ error: 'Server configuration error' }, 500);
        }
        
        const decoded = jwt.verify(token, secret);
        c.set('user', decoded);
        await next();
    } catch (err) {
        return c.json({ error: 'Invalid or expired token' }, 403);
    }
};

export const restrictToAdmin = async (c, next) => {
    const user = c.get('user');
    if (!user || user.role !== 'admin') {
        return c.json({ error: 'Admin access required' }, 403);
    }
    await next();
};
