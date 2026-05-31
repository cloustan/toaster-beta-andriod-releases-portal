/** Must match the native app URL scheme + Cognito app client callback URL for native builds. */
const NATIVE_OAUTH_REDIRECT_URI = 'com.toaster.cloustan://auth';
const AWS_SDK_URLS = [
  './aws-sdk.min.js',
  '/aws-sdk.min.js',
  'aws-sdk.min.js',
  'https://sdk.amazonaws.com/js/aws-sdk-2.1693.0.min.js',
  'https://cdn.jsdelivr.net/npm/aws-sdk@2.1693.0/dist/aws-sdk.min.js',
  'https://unpkg.com/aws-sdk@2.1693.0/dist/aws-sdk.min.js'
];
const COGNITO_SDK_URLS = [
  './amazon-cognito-identity.min.js',
  '/amazon-cognito-identity.min.js',
  'amazon-cognito-identity.min.js',
  'https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6.3.16/dist/amazon-cognito-identity.min.js',
  'https://unpkg.com/amazon-cognito-identity-js@6.3.16/dist/amazon-cognito-identity.min.js'
];
const AUTH_CACHE_KEY = 'toaster_auth_cache_v1';

function isCapacitorNativeClient() {
  try {
    return (
      typeof window !== 'undefined' &&
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    );
  } catch (_) {
    return false;
  }
}

function getOAuthRedirectSignIn() {
  return isCapacitorNativeClient() ? NATIVE_OAUTH_REDIRECT_URI : `${window.location.origin}/auth.html`;
}

function getOAuthRedirectSignOut() {
  return isCapacitorNativeClient() ? NATIVE_OAUTH_REDIRECT_URI : `${window.location.origin}/auth.html`;
}

// AWS Cognito configuration
const COGNITO_CONFIG = {
  userPoolId: 'us-east-1_dDERSu0t4',
  clientId: '1rstnnf30o6qv7nntdnplpck03',
  region: 'us-east-1',
  hostedUiDomain: '',
  responseType: 'token',
  scopes: ['openid', 'email', 'profile'],
  supportedProviders: {
    google: 'Google',
    apple: 'SignInWithApple',
    discord: 'Discord'
  }
};

function getRuntimeAuthConfig() {
  try {
    if (typeof window !== 'undefined' && window.__TOASTER_AUTH_CONFIG && typeof window.__TOASTER_AUTH_CONFIG === 'object') {
      return window.__TOASTER_AUTH_CONFIG;
    }
  } catch (_) {}
  return {};
}

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.authStateListeners = [];
    this.userPool = null;
    this.cognitoUser = null;
    this.cognitoIdp = null;
    this.oauthCallbackPromise = null;
    this.pendingEmailOtpSession = '';
    this.pendingSignUpSession = '';
    this.sdkLoadPromise = null;
    if (isCapacitorNativeClient()) {
      setTimeout(() => {
        this.ensureSdkReady().catch(() => {});
      }, 0);
    }
  }

  loadExternalScriptWithFallback(urls, isReadyFn) {
    const sources = Array.isArray(urls) ? urls.slice() : [];
    const LOCAL_SCRIPT_TIMEOUT_MS = 20000;
    const REMOTE_SCRIPT_TIMEOUT_MS = 8000;
    return new Promise((resolve, reject) => {
      const attempt = (index) => {
        if (index >= sources.length) {
          reject(new Error('All script sources failed'));
          return;
        }
        if (typeof isReadyFn === 'function' && isReadyFn()) {
          resolve(true);
          return;
        }

        const src = sources[index];
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing && (existing.dataset.toasterLoaded === '1' || (typeof isReadyFn === 'function' && isReadyFn()))) {
          resolve(true);
          return;
        }

        const script = existing || document.createElement('script');
        script.src = src;
        script.async = false;
        let finished = false;
        const timeoutMs = /^https?:\/\//i.test(src) ? REMOTE_SCRIPT_TIMEOUT_MS : LOCAL_SCRIPT_TIMEOUT_MS;
        const timer = setTimeout(() => {
          if (finished) return;
          finished = true;
          try {
            script.onerror = null;
            script.onload = null;
          } catch (_) {}
          if (!existing && script.parentNode) {
            script.parentNode.removeChild(script);
          }
          attempt(index + 1);
        }, timeoutMs);

        script.onload = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          script.dataset.toasterLoaded = '1';
          resolve(true);
        };
        script.onerror = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (!existing && script.parentNode) {
            script.parentNode.removeChild(script);
          }
          attempt(index + 1);
        };

        if (!existing) {
          document.head.appendChild(script);
        }
      };

      attempt(0);
    });
  }

  async ensureSdkReady() {
    if (typeof AWS !== 'undefined' && typeof AmazonCognitoIdentity !== 'undefined') {
      return true;
    }

    if (!this.sdkLoadPromise) {
      this.sdkLoadPromise = (async () => {
        if (typeof AWS === 'undefined') {
          await this.loadExternalScriptWithFallback(AWS_SDK_URLS, () => typeof AWS !== 'undefined');
        }
        if (typeof AmazonCognitoIdentity === 'undefined') {
          await this.loadExternalScriptWithFallback(COGNITO_SDK_URLS, () => typeof AmazonCognitoIdentity !== 'undefined');
        }
      })().catch(() => false).finally(() => {
        this.sdkLoadPromise = null;
      });
    }

    await this.sdkLoadPromise;
    return typeof AWS !== 'undefined' && typeof AmazonCognitoIdentity !== 'undefined';
  }

  initCognito() {
    if (typeof AmazonCognitoIdentity === 'undefined') {
      return false;
    }
    
    if (!this.userPool) {
      const poolData = {
        UserPoolId: COGNITO_CONFIG.userPoolId,
        ClientId: COGNITO_CONFIG.clientId
      };
      this.userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
    }
    return true;
  }

  initCognitoIdp() {
    if (typeof AWS === 'undefined' || !AWS.CognitoIdentityServiceProvider) {
      return null;
    }

    try {
      AWS.config.region = COGNITO_CONFIG.region;
    } catch (_) {}

    if (!this.cognitoIdp) {
      this.cognitoIdp = new AWS.CognitoIdentityServiceProvider({
        region: COGNITO_CONFIG.region
      });
    }

    return this.cognitoIdp;
  }

  normalizeEmail(email) {
    return String(email || '').toLowerCase().trim();
  }

  clearPendingAuthSessions() {
    this.pendingEmailOtpSession = '';
    this.pendingSignUpSession = '';
  }

  getCachedSession() {
    try {
      const raw = localStorage.getItem(AUTH_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.accessToken || !parsed.idToken) return null;
      const payload = this.decodeJwtPayload(parsed.idToken);
      if (!payload || !payload.exp) return null;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp <= nowSeconds + 15) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  cacheSession(tokens) {
    try {
      if (!tokens || !tokens.accessToken || !tokens.idToken) return;
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken || ''
      }));
    } catch (_) {}
  }

  clearCachedSession() {
    try {
      localStorage.removeItem(AUTH_CACHE_KEY);
    } catch (_) {}
  }

  restoreUserFromCachedTokens(tokens) {
    const idPayload = this.decodeJwtPayload(tokens.idToken);
    const accessPayload = this.decodeJwtPayload(tokens.accessToken);
    if (!idPayload || !accessPayload) {
      return { isAuthenticated: false, user: null };
    }
    const groups = idPayload['cognito:groups'] || [];
    const user = {
      username: idPayload['cognito:username'] || idPayload.email || accessPayload.username || accessPayload.sub || '',
      sub: idPayload.sub || accessPayload.sub || null,
      email: idPayload.email || accessPayload.username || '',
      groups,
      isAdmin: groups.includes('admins'),
      token: tokens.accessToken,
      idToken: tokens.idToken
    };
    this.currentUser = user;
    this.notifyListeners({ isAuthenticated: true, user });
    return { isAuthenticated: true, user };
  }

  callPublicAuthApi(operation, params) {
    const client = this.initCognitoIdp();
    if (!client || typeof client.makeUnauthenticatedRequest !== 'function') {
      return Promise.resolve({ success: false, error: 'AWS SDK not loaded' });
    }

    return new Promise((resolve) => {
      client.makeUnauthenticatedRequest(operation, params, (err, data) => {
        if (err) {
          resolve({
            success: false,
            error: err.message || 'Cognito request failed',
            code: err.code || err.name || ''
          });
          return;
        }

        resolve({ success: true, data: data || {} });
      });
    });
  }

  finishAuthentication(authenticationResult) {
    const established = this.establishSessionFromTokens({
      accessToken: authenticationResult.AccessToken,
      idToken: authenticationResult.IdToken,
      refreshToken: authenticationResult.RefreshToken || ''
    });

    if (!established.success) {
      return established;
    }

    this.clearPendingAuthSessions();
    return { success: true, isSignedIn: true, user: established.user };
  }

  async continueEmailOtpChallenge(normalizedEmail, responseData) {
    if (responseData.AuthenticationResult) {
      return this.finishAuthentication(responseData.AuthenticationResult);
    }

    if (responseData.ChallengeName === 'SELECT_CHALLENGE' && responseData.Session) {
      const selectedChallenge = await this.callPublicAuthApi('respondToAuthChallenge', {
        ClientId: COGNITO_CONFIG.clientId,
        ChallengeName: 'SELECT_CHALLENGE',
        Session: responseData.Session,
        ChallengeResponses: {
          USERNAME: normalizedEmail,
          ANSWER: 'EMAIL_OTP'
        }
      });

      if (!selectedChallenge.success) {
        return selectedChallenge;
      }

      return this.continueEmailOtpChallenge(normalizedEmail, selectedChallenge.data);
    }

    if (responseData.ChallengeName === 'EMAIL_OTP' && responseData.Session) {
      this.pendingEmailOtpSession = responseData.Session;
      return { success: true, challenge: 'EMAIL_OTP' };
    }

    return {
      success: false,
      error: 'Email OTP is not enabled for this Cognito app client yet'
    };
  }

  async startEmailOtpSignIn(email, session) {
    const normalizedEmail = this.normalizeEmail(email);
    const result = await this.callPublicAuthApi('initiateAuth', {
      AuthFlow: 'USER_AUTH',
      ClientId: COGNITO_CONFIG.clientId,
      AuthParameters: {
        USERNAME: normalizedEmail,
        PREFERRED_CHALLENGE: 'EMAIL_OTP'
      },
      ...(session ? { Session: session } : {})
    });

    if (!result.success) {
      return result;
    }

    return this.continueEmailOtpChallenge(normalizedEmail, result.data);
  }

  async verifyEmailOtp(email, code) {
    const normalizedEmail = this.normalizeEmail(email);

    if (!this.pendingEmailOtpSession) {
      return { success: false, error: 'No email sign-in session is waiting for a code' };
    }

    const result = await this.callPublicAuthApi('respondToAuthChallenge', {
      ClientId: COGNITO_CONFIG.clientId,
      ChallengeName: 'EMAIL_OTP',
      Session: this.pendingEmailOtpSession,
      ChallengeResponses: {
        USERNAME: normalizedEmail,
        EMAIL_OTP_CODE: code
      }
    });

    if (!result.success) {
      return result;
    }

    if (!result.data.AuthenticationResult) {
      return { success: false, error: 'Cognito did not return tokens after code verification' };
    }

    return this.finishAuthentication(result.data.AuthenticationResult);
  }

  async signUpPasswordless(email) {
    const normalizedEmail = this.normalizeEmail(email);

    const result = await this.callPublicAuthApi('signUp', {
      ClientId: COGNITO_CONFIG.clientId,
      Username: normalizedEmail,
      UserAttributes: [
        {
          Name: 'email',
          Value: normalizedEmail
        }
      ]
    });

    if (!result.success) {
      return result;
    }

    this.pendingSignUpSession = result.data.Session || '';

    return {
      success: true,
      userId: result.data.UserSub,
      userConfirmed: Boolean(result.data.UserConfirmed)
    };
  }

  async resendSignUpCode(email) {
    const normalizedEmail = this.normalizeEmail(email);

    return this.callPublicAuthApi('resendConfirmationCode', {
      ClientId: COGNITO_CONFIG.clientId,
      Username: normalizedEmail
    });
  }

  async confirmSignUpAndSignIn(email, code) {
    const normalizedEmail = this.normalizeEmail(email);

    const confirmResult = await this.callPublicAuthApi('confirmSignUp', {
      ClientId: COGNITO_CONFIG.clientId,
      Username: normalizedEmail,
      ConfirmationCode: code,
      ...(this.pendingSignUpSession ? { Session: this.pendingSignUpSession } : {})
    });

    if (!confirmResult.success) {
      return confirmResult;
    }

    const signInResult = await this.startEmailOtpSignIn(normalizedEmail, confirmResult.data.Session || '');
    if (signInResult.success && signInResult.isSignedIn) {
      return signInResult;
    }

    if (signInResult.success && signInResult.challenge === 'EMAIL_OTP') {
      return {
        success: true,
        requiresAdditionalOtp: true
      };
    }

    return signInResult;
  }

  getHostedUiBaseUrl() {
    const runtimeConfig = getRuntimeAuthConfig();
    const hostedUiDomain = (runtimeConfig.hostedUiDomain || COGNITO_CONFIG.hostedUiDomain || '').trim();
    if (!hostedUiDomain) {
      return null;
    }

    const normalizedDomain = hostedUiDomain.replace(/^https?:\/\//, '');
    return `https://${normalizedDomain}`;
  }

  isHostedUiConfigured() {
    return Boolean(this.getHostedUiBaseUrl());
  }

  getSupportedProviders() {
    const runtimeConfig = getRuntimeAuthConfig();
    const configuredProviders = (runtimeConfig.supportedProviders && typeof runtimeConfig.supportedProviders === 'object')
      ? runtimeConfig.supportedProviders
      : COGNITO_CONFIG.supportedProviders;
    return Object.entries(configuredProviders).map(([key, value]) => ({
      key,
      cognitoName: value
    }));
  }

  buildHostedUiUrl(providerKey) {
    const baseUrl = this.getHostedUiBaseUrl();
    const runtimeConfig = getRuntimeAuthConfig();
    const providerMap = this.getSupportedProviders().reduce((acc, provider) => {
      acc[provider.key] = provider.cognitoName;
      return acc;
    }, {});
    const identityProvider = providerMap[providerKey];
    const responseType = runtimeConfig.responseType || COGNITO_CONFIG.responseType;
    const scopes = Array.isArray(runtimeConfig.scopes) && runtimeConfig.scopes.length > 0
      ? runtimeConfig.scopes
      : COGNITO_CONFIG.scopes;

    if (!baseUrl || !identityProvider) {
      return null;
    }

    const params = new URLSearchParams({
      client_id: COGNITO_CONFIG.clientId,
      response_type: responseType,
      scope: scopes.join(' '),
      redirect_uri: getOAuthRedirectSignIn(),
      identity_provider: identityProvider
    });

    return `${baseUrl}/oauth2/authorize?${params.toString()}`;
  }

  async signInWithProvider(providerKey) {
    const authUrl = this.buildHostedUiUrl(providerKey);

    if (!authUrl) {
      return { success: false, error: 'OAuth provider is not configured yet' };
    }

    if (typeof window.__capOpenHostedOAuth === 'function') {
      try {
        await window.__capOpenHostedOAuth(authUrl);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e && e.message) || 'Could not open sign-in browser' };
      }
    }

    window.location.assign(authUrl);
    return { success: true };
  }

  getHostedUiSignOutUrl() {
    const baseUrl = this.getHostedUiBaseUrl();
    if (!baseUrl) {
      return null;
    }

    const params = new URLSearchParams({
      client_id: COGNITO_CONFIG.clientId,
      logout_uri: getOAuthRedirectSignOut()
    });

    return `${baseUrl}/logout?${params.toString()}`;
  }

  parseOAuthCallback() {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) {
      return null;
    }

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const idToken = params.get('id_token');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    if (error) {
      return {
        error,
        errorDescription: errorDescription ? decodeURIComponent(errorDescription.replace(/\+/g, ' ')) : 'OAuth sign-in failed'
      };
    }

    if (!accessToken || !idToken) {
      return null;
    }

    return {
      accessToken,
      idToken,
      refreshToken: params.get('refresh_token') || ''
    };
  }

  decodeJwtPayload(token) {
    try {
      const payloadSegment = token.split('.')[1];
      if (!payloadSegment) {
        return null;
      }

      const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      return JSON.parse(atob(padded));
    } catch (error) {
      return null;
    }
  }

  establishSessionFromTokens(tokens) {
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    const idPayload = this.decodeJwtPayload(tokens.idToken);
    const accessPayload = this.decodeJwtPayload(tokens.accessToken);

    if (!idPayload || !accessPayload) {
      return { success: false, error: 'Invalid OAuth token payload' };
    }

    const username = idPayload['cognito:username'] || idPayload.email || accessPayload.username || accessPayload.sub;
    if (!username) {
      return { success: false, error: 'Unable to resolve Cognito user from OAuth response' };
    }

    const userData = {
      Username: username,
      Pool: this.userPool
    }; 
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    const session = new AmazonCognitoIdentity.CognitoUserSession({
      IdToken: new AmazonCognitoIdentity.CognitoIdToken({ IdToken: tokens.idToken }),
      AccessToken: new AmazonCognitoIdentity.CognitoAccessToken({ AccessToken: tokens.accessToken }),
      RefreshToken: new AmazonCognitoIdentity.CognitoRefreshToken({ RefreshToken: tokens.refreshToken || '' })
    });

    cognitoUser.setSignInUserSession(session);
    this.cognitoUser = cognitoUser;

    const groups = idPayload['cognito:groups'] || [];
    this.currentUser = {
      username,
      sub: idPayload.sub || accessPayload.sub || null,
      email: idPayload.email || accessPayload.username || '',
      groups,
      isAdmin: groups.includes('admins'),
      token: tokens.accessToken,
      idToken: tokens.idToken
    };
    this.cacheSession(tokens);

    this.notifyListeners({ isAuthenticated: true, user: this.currentUser });
    return { success: true, user: this.currentUser };
  }

  async handleOAuthCallback() {
    if (this.oauthCallbackPromise) {
      return this.oauthCallbackPromise;
    }

    this.oauthCallbackPromise = Promise.resolve().then(async () => {
      const callback = this.parseOAuthCallback();

      if (!callback) {
        return { success: false, handled: false };
      }

      if (callback.error) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        return { success: false, handled: true, error: callback.errorDescription };
      }

      const sdkReady = await this.ensureSdkReady();
      if (!sdkReady) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        return { success: false, handled: true, error: 'Cognito SDK not loaded' };
      }

      const result = this.establishSessionFromTokens(callback);
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      return { ...result, handled: true };
    }).finally(() => {
      this.oauthCallbackPromise = null;
    });

    return this.oauthCallbackPromise;
  }

  async checkAuthState() {
    const cached = this.getCachedSession();
    if (cached) {
      return this.restoreUserFromCachedTokens(cached);
    }

    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { isAuthenticated: false, user: null };
    }

    try {
      const cognitoUser = this.userPool.getCurrentUser();
      
      if (!cognitoUser) {
        this.currentUser = null;
        this.notifyListeners({ isAuthenticated: false, user: null });
        return { isAuthenticated: false, user: null };
      }

      return new Promise((resolve) => {
        cognitoUser.getSession((err, session) => {
          if (err || !session.isValid()) {
            this.currentUser = null;
            this.notifyListeners({ isAuthenticated: false, user: null });
            resolve({ isAuthenticated: false, user: null });
            return;
          }

          const idToken = session.getIdToken();
          const accessToken = session.getAccessToken();
          const groups = idToken.payload['cognito:groups'] || [];
          
          const user = {
            username: cognitoUser.getUsername(),
            sub: idToken.payload.sub,
            email: idToken.payload.email,
            groups: groups,
            isAdmin: groups.includes('admins'),
            token: accessToken.getJwtToken(),
            idToken: idToken.getJwtToken()
          };
          
          this.currentUser = user;
          this.cognitoUser = cognitoUser;
          this.cacheSession({
            accessToken: accessToken.getJwtToken(),
            idToken: idToken.getJwtToken(),
            refreshToken: ''
          });
          this.notifyListeners({ isAuthenticated: true, user });
          resolve({ isAuthenticated: true, user });
        });
      });
    } catch (error) {
      this.currentUser = null;
      this.notifyListeners({ isAuthenticated: false, user: null });
      return { isAuthenticated: false, user: null };
    }
  }

  async signUp(email, password) {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    // Normalize email to lowercase to prevent case sensitivity issues
    const normalizedEmail = email.toLowerCase().trim();

    return new Promise((resolve) => {
      const attributeList = [
        new AmazonCognitoIdentity.CognitoUserAttribute({
          Name: 'email',
          Value: normalizedEmail
        })
      ];

      this.userPool.signUp(normalizedEmail, password, attributeList, null, (err, result) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true, userId: result.userSub });
      });
    });
  }

  async confirmSignUp(email, code) {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    // Normalize email to lowercase to match signup
    const normalizedEmail = email.toLowerCase().trim();

    return new Promise((resolve) => {
      const userData = {
        Username: normalizedEmail,
        Pool: this.userPool
      };
      const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

      cognitoUser.confirmRegistration(code, true, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true });
      });
    });
  }

  async signIn(email, password) {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    // Normalize email to lowercase to match signup
    const normalizedEmail = email.toLowerCase().trim();

    return new Promise((resolve) => {
      const authenticationData = {
        Username: normalizedEmail,
        Password: password
      };
      const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);

      const userData = {
        Username: normalizedEmail,
        Pool: this.userPool
      };
      const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (session) => {
          this.cognitoUser = cognitoUser;
          this.currentUser = {
            username: cognitoUser.getUsername(),
            sub: session.getIdToken().payload.sub,
            email: session.getIdToken().payload.email,
            token: session.getAccessToken().getJwtToken(),
            idToken: session.getIdToken().getJwtToken()
          };
          this.cacheSession({
            accessToken: session.getAccessToken().getJwtToken(),
            idToken: session.getIdToken().getJwtToken(),
            refreshToken: ''
          });
          this.notifyListeners({ isAuthenticated: true, user: this.currentUser });
          resolve({ success: true, isSignedIn: true });
        },
        onFailure: (err) => {
          resolve({ success: false, error: err.message });
        }
      });
    });
  }

  async signOut() {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    return new Promise((resolve) => {
      const cognitoUser = this.userPool.getCurrentUser();
      if (cognitoUser) {
        cognitoUser.signOut();
      }
      this.currentUser = null;
      this.clearCachedSession();
      this.clearPendingAuthSessions();
      this.notifyListeners({ isAuthenticated: false, user: null });
      const hostedUiSignOutUrl = this.getHostedUiSignOutUrl();
      if (hostedUiSignOutUrl) {
        window.location.assign(hostedUiSignOutUrl);
        return;
      }
      resolve({ success: true });
    });
  }

  async forgotPassword(email) {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    const normalizedEmail = email.toLowerCase().trim();

    return new Promise((resolve) => {
      const userData = {
        Username: normalizedEmail,
        Pool: this.userPool
      };
      const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

      cognitoUser.forgotPassword({
        onSuccess: () => {
          // Send Discord notification
          if (window.discordNotifier) {
            window.discordNotifier.notifyPasswordReset(normalizedEmail);
          }
          resolve({ success: true });
        },
        onFailure: (err) => {
          resolve({ success: false, error: err.message });
        }
      });
    });
  }

  async confirmPassword(email, code, newPassword) {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    const normalizedEmail = email.toLowerCase().trim();

    return new Promise((resolve) => {
      const userData = {
        Username: normalizedEmail,
        Pool: this.userPool
      };
      const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

      cognitoUser.confirmPassword(code, newPassword, {
        onSuccess: () => {
          resolve({ success: true });
        },
        onFailure: (err) => {
          resolve({ success: false, error: err.message });
        }
      });
    });
  }

  async getCurrentUser() {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return null;
    }

    const cognitoUser = this.userPool.getCurrentUser();
    if (!cognitoUser) {
      return null;
    }

    return new Promise((resolve) => {
      cognitoUser.getSession((err, session) => {
        if (err || !session.isValid()) {
          resolve(null);
          return;
        }
        resolve({
          username: cognitoUser.getUsername(),
          email: session.getIdToken().payload.email,
          userId: session.getIdToken().payload.sub
        });
      });
    });
  }

  async getAuthToken() {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return null;
    }

    const cognitoUser = this.userPool.getCurrentUser();
    if (!cognitoUser) {
      return null;
    }

    return new Promise((resolve) => {
      cognitoUser.getSession((err, session) => {
        if (err || !session.isValid()) {
          resolve(null);
          return;
        }
        resolve(session.getAccessToken().getJwtToken());
      });
    });
  }

  async getIdToken() {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return null;
    }

    const cognitoUser = this.userPool.getCurrentUser();
    if (!cognitoUser) {
      return null;
    }

    return new Promise((resolve) => {
      cognitoUser.getSession((err, session) => {
        if (err || !session.isValid()) {
          resolve(null);
          return;
        }
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  async deleteAccount() {
    await this.ensureSdkReady();
    if (!this.initCognito()) {
      return { success: false, error: 'Cognito SDK not loaded' };
    }

    return new Promise((resolve) => {
      const cognitoUser = this.userPool.getCurrentUser();
      if (!cognitoUser) {
        resolve({ success: false, error: 'No user logged in' });
        return;
      }

      cognitoUser.getSession(async (err, session) => {
        if (err || !session.isValid()) {
          resolve({ success: false, error: 'Invalid session' });
          return;
        }

        const email = session.getIdToken().payload.email;
        const userId = session.getIdToken().payload.sub;

        cognitoUser.deleteUser((err) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }

          // Send Discord notification
          if (window.discordNotifier) {
            window.discordNotifier.notifyAccountDeletion(email, userId);
          }

          this.currentUser = null;
          this.notifyListeners({ isAuthenticated: false, user: null });
          resolve({ success: true });
        });
      });
    });
  }

  onAuthStateChange(callback) {
    this.authStateListeners.push(callback);
    return () => {
      this.authStateListeners = this.authStateListeners.filter(cb => cb !== callback);
    };
  }

  notifyListeners(state) {
    this.authStateListeners.forEach(callback => callback(state));
  }

  // Check if current user is admin
  isAdmin() {
    return this.currentUser?.isAdmin || false;
  }

  // Get user role
  getUserRole() {
    if (!this.currentUser) return 'guest';
    return this.currentUser.isAdmin ? 'admin' : 'user';
  }

  // Get user groups
  getUserGroups() {
    return this.currentUser?.groups || [];
  }
}

window.authManager = new AuthManager();
