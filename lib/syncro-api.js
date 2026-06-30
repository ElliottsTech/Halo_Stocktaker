const axios = require('axios');
require('dotenv').config();

const SYNCRO_STATUSES = ['sold', 'reserved', 'in_stock', 'returned', 'in_transfer', 'breakage', 'used_in_refurb'];

class SyncroAPI {
  constructor() {
    this.baseURL = process.env.SYNCRO_BASE_URL || 'https://elliotts.syncromsp.com';
    this.token = process.env.SYNCRO_API_TOKEN;
    if (!this.token) throw new Error('SYNCRO_API_TOKEN not set in .env');
    this.cache = new Map();
  }

  async fetchProductSerials(productId, status) {
    const key = `${productId}:${status}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const url = `${this.baseURL}/api/v1/products/${productId}/product_serials`;
    try {
      const resp = await axios.get(url, {
        headers: {
          'Accept': '*/*',
          'Authorization': this.token
        },
        params: { status },
        timeout: 30000
      });
      const serials = resp.data && resp.data.product_serials ? resp.data.product_serials : [];
      this.cache.set(key, serials);
      return serials;
    } catch (err) {
      const status_code = err.response ? err.response.status : 'no-response';
      const msg = err.response && err.response.data ? JSON.stringify(err.response.data).slice(0, 200) : err.message;
      console.error(`Syncro fetch failed product=${productId} status=${status} http=${status_code}: ${msg}`);
      this.cache.set(key, []);
      return [];
    }
  }

  async findSerialId(productId, serial) {
    if (!serial) return { id: null, status: null };
    const target = String(serial).trim().toLowerCase();

    for (const status of SYNCRO_STATUSES) {
      const serials = await this.fetchProductSerials(productId, status);
      const hit = serials.find(s => s.serial_number && String(s.serial_number).trim().toLowerCase() === target);
      if (hit) return { id: hit.id, status: hit.status || status };
    }
    return { id: null, status: null };
  }
}

module.exports = { SyncroAPI, SYNCRO_STATUSES };
