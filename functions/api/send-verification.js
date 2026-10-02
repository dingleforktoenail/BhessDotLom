export async function onRequestPost(context) {
  try {
    const { email } = await context.request.json();
    if (!email) {
      return new Response(JSON.stringify({ success: false, error: 'Email required' }), { status: 400 });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${context.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'BHESS <onboarding@resend.dev>',
        to: [email],
        subject: 'BHESS Verification Code',
        html: `<p>Your 6-digit verification code is: <strong>${code}</strong></p>`
      })
    });

    if (!res.ok) {
      const err = await res.json();
      return new Response(JSON.stringify({ success: false, error: err.message || 'Resend API error' }), { status: 400 });
    }

    if (context.env.BHESS_KV) {
      await context.env.BHESS_KV.put(email.toLowerCase(), code, { expirationTtl: 600 });
    }

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
