export const DAY = 24 * 60 * 60 * 1000;
export const sessionDuration = remember => remember === true ? 7 * DAY : DAY;
export const sessionToken = req => req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('session='))?.slice(8) || '';
export const cookieOptions = (env = process.env) => ({httpOnly:true,sameSite:'strict',path:'/',secure:env.COOKIE_SECURE==='true'||env.CODESPACES==='true'});
