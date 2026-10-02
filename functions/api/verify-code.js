export async function onRequestPost(context) {
  try {
    const { email, code } = await context.request.json();
    if (!email || !code) {
      return new Response(JSON.stringify({ success: false, error: 'Email and code required' }), { status: 400 });
    }

    let storedCode = null;
    if (context.env.BHESS_KV) {
      storedCode = await context.env.BHESS_KV.get(email.toLowerCase());
    }

    if (storedCode && storedCode === code.trim()) {
      await context.env.BHESS_KV.delete(email.toLowerCase());
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    } else {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired verification code' }), { status: 400 });
    }
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
