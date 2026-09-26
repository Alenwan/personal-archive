alter table user_credentials alter column password_iterations set default 100000;

comment on column user_credentials.password_iterations is 'PBKDF2 iteration count. Cloudflare Workers currently support values up to 100000.';
