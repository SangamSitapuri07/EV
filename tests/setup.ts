// Vitest global setup: ensure test mode uses in-memory PGlite cleanly
process.env.DATABASE_URL = "pglite://memory";
process.env.AUTH_JWT_SECRET = "vitest-jwt-secret-key-at-least-32-chars";
process.env.QR_SIGNING_SECRET = "vitest-qr-signing-secret-key-32-chars";
process.env.RAZORPAY_KEY_SECRET = "rzp_test_sandbox_demo_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test_sandbox_webhook_secret";
process.env.PAYMENT_GATEWAY_MODE = "sandbox";
