export const KRA_BASE = 'https://api.kra.sk/';

function disabledError() {
  const err = new Error('Native KRA login is disabled. This deployment uses the cder bridge only.');
  err.code = 'KRA_LOGIN_DISABLED_BRIDGE_ONLY';
  return err;
}

export class KraClient {
  constructor(config) {
    this.config = config;
  }

  clearSession() {}

  async login() {
    throw disabledError();
  }

  async userInfo() {
    throw disabledError();
  }

  async listFiles() {
    throw disabledError();
  }

  async resolveIdent() {
    throw disabledError();
  }
}
