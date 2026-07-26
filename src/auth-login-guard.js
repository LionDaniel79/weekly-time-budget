import { installGoogleLoginGuard } from './auth-login.js';

const loginButton = document.querySelector('#google-login');
if (loginButton) installGoogleLoginGuard(loginButton);
