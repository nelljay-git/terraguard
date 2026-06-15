import { rewrite, next } from '@vercel/edge';
import { isbot } from 'isbot';

export default function middleware(request: Request) {
  const url = new URL(request.url);
  
  // Only intercept /details/:id routes
  if (url.pathname.startsWith('/details/')) {
    const userAgent = request.headers.get('user-agent') || '';
    
    if (isbot(userAgent)) {
      // Extract the ID from the path (e.g., /details/XYZ123 -> XYZ123)
      const id = url.pathname.split('/')[2];
      
      if (id) {
        // Rewrite to the API endpoint that generates the OG tags
        url.pathname = '/api/og-details';
        url.searchParams.set('id', id);
        return rewrite(url);
      }
    }
  }
  
  return next();
}

export const config = {
  matcher: '/details/:id*',
};
