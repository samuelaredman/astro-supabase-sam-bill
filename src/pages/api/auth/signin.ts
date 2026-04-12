---
---
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <meta name="theme-color" content="#141412" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0f0f0e" media="(prefers-color-scheme: dark)" />
  <title>Sign in — Cartridge</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap" rel="stylesheet" />
  <style>
    :root[data-theme="light"] {
      --bg: #f9f8f6;
      --bg-card: #ffffff;
      --border: #e8e6e1;
      --text-primary: #141412;
      --text-secondary: #6b6860;
      --text-tertiary: #a09d98;
      --accent: #141412;
      --accent-text: #ffffff;
      --input-bg: #ffffff;
      --error: #c0392b;
      --error-bg: #fdf0ee;
    }
    :root[data-theme="dark"] {
      --bg: #0f0f0e;
      --bg-card: #1a1a18;
      --border: #2a2a27;
      --text-primary: #f0ede8;
      --text-secondary: #908d87;
      --text-tertiary: #5a5855;
      --accent: #f0ede8;
      --accent-text: #141412;
      --input-bg: #222220;
      --error: #f87171;
      --error-bg: #2b0d0d;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'DM Sans', sans-serif;
      background: var(--bg);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }

    a { color: inherit; text-decoration: none; }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
    }

    .logo {
      font-family: 'DM Serif Display', serif;
      font-size: 22px;
      letter-spacing: -0.5px;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .logo-dot {
      width: 8px;
      height: 8px;
      background: var(--text-primary);
      border-radius: 50%;
    }

    h1 {
      font-size: 22px;
      font-weight: 500;
      letter-spacing: -0.3px;
      margin-bottom: 6px;
    }

    .subtitle {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 28px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    input {
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 15px;
      font-family: inherit;
      color: var(--text-primary);
      width: 100%;
      transition: border-color 0.15s;
      outline: none;
    }

    input:focus { border-color: var(--text-secondary); }

    .submit-btn {
      width: 100%;
      background: var(--accent);
      color: var(--accent-text);
      border: none;
      border-radius: 10px;
      padding: 12px;
      font-size: 15px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.15s;
    }
    .submit-btn:hover { opacity: 0.85; }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .error-msg {
      background: var(--error-bg);
      color: var(--error);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      margin-bottom: 16px;
      display: none;
    }
    .error-msg.visible { display: block; }

    .footer-link {
      text-align: center;
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: 24px;
    }

    .footer-link a {
      color: var(--text-primary);
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  </style>
</head>
<body>
  <div class="card">
    <a href="/" class="logo">
      <span class="logo-dot"></span>
      Cartridge
    </a>

    <h1>Welcome back</h1>
    <p class="subtitle">Sign in to your account to continue.</p>

    <div class="error-msg" id="errorMsg"></div>

    <form id="signinForm">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" placeholder="you@example.com" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="••••••••" required />
      </div>
      <button type="submit" class="submit-btn" id="submitBtn">Sign in</button>
    </form>

    <p class="footer-link">
      Don't have an account? <a href="/signup">Sign up</a>
    </p>
  </div>

  <script>
    const saved = localStorage.getItem('theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', saved);

    const form = document.getElementById('signinForm') as HTMLFormElement;
    const errorMsg = document.getElementById('errorMsg') as HTMLDivElement;
    const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.remove('visible');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      const email = (document.getElementById('email') as HTMLInputElement).value;
      const password = (document.getElementById('password') as HTMLInputElement).value;

      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        errorMsg.textContent = data.error ?? 'Something went wrong. Please try again.';
        errorMsg.classList.add('visible');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      } else {
        window.location.href = '/';
      }
    });
  </script>
</body>
</html>
