const fs = require('fs');

async function runTest() {
  console.log('=== STEP 1: TEST VERCEL HTML ===');
  const vercelUrl = 'https://mozhilearn-web.vercel.app/login';
  const response = await fetch(vercelUrl);
  console.log('Vercel login status:', response.status);
  const html = await response.text();
  console.log('HTML length:', html.length);

  // Extract JS bundle links
  const scriptRegex = /<script[^>]+src=["']([^"']+\.js)["']/g;
  let match;
  const scriptUrls = [];
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = match[1];
    scriptUrls.push(src.startsWith('http') ? src : 'https://mozhilearn-web.vercel.app' + src);
  }
  console.log('Found JS bundles on Vercel:', scriptUrls);

  for (const url of scriptUrls) {
    const res = await fetch(url);
    const code = await res.text();
    console.log(`Bundle ${url} size: ${code.length} bytes`);
    
    // Look for backend URL references
    const renderMatches = [...code.matchAll(/https?:\/\/[a-zA-Z0-9._-]*onrender\.com/g)].map(m => m[0]);
    console.log('Render backend references in bundle:', [...new Set(renderMatches)]);
    
    // Look for fallback or default URL
    const localhostMatches = [...code.matchAll(/http:\/\/localhost:5000/g)].map(m => m[0]);
    console.log('localhost:5000 references in bundle:', localhostMatches.length);
  }

  console.log('\n=== STEP 2: TEST RENDER BACKEND HEALTH ===');
  const renderBase = window.location.origin;
  
  const rootRes = await fetch(`${renderBase}/`);
  console.log('GET / status:', rootRes.status);
  console.log('GET / response:', await rootRes.json());

  const healthRes = await fetch(`${renderBase}/api/health`);
  console.log('GET /api/health status:', healthRes.status);
  console.log('GET /api/health response:', await healthRes.json());

  const dbRes = await fetch(`${renderBase}/api/test-db`);
  console.log('GET /api/test-db status:', dbRes.status);
  console.log('GET /api/test-db response:', await dbRes.json());

  console.log('\n=== STEP 3: TEST AUTH FLOW ON RENDER ===');
  // Check CSRF bootstrap
  const csrfRes = await fetch(`${renderBase}/api/auth/csrf`, {
    headers: {
      Origin: 'https://mozhilearn-web.vercel.app'
    }
  });
  console.log('CSRF status:', csrfRes.status);
  console.log('Access-Control-Allow-Origin:', csrfRes.headers.get('access-control-allow-origin'));
  console.log('Access-Control-Allow-Credentials:', csrfRes.headers.get('access-control-allow-credentials'));
  const csrfCookie = csrfRes.headers.get('set-cookie');
  console.log('CSRF set-cookie header:', csrfCookie ? 'Received cookie' : 'NONE');
  const csrfPayload = await csrfRes.json();
  console.log('CSRF payload:', csrfPayload);

  // Attempt login with credentials
  if (csrfPayload.csrf_token && csrfCookie) {
    const rawCsrfCookie = csrfCookie.split(';')[0];
    const loginRes = await fetch(`${renderBase}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfPayload.csrf_token,
        'Cookie': rawCsrfCookie,
        Origin: 'https://mozhilearn-web.vercel.app'
      },
      body: JSON.stringify({
        email: 'kalaikannan0181@gmail.com',
        password: 'Kalaikannan'
      })
    });
    console.log('Login status:', loginRes.status);
    console.log('Login payload:', await loginRes.json());
  }
}

runTest().catch(console.error);
