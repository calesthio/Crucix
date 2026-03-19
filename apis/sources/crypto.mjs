// Crypto Market Data — CCXT spot prices + CoinMarketCap market metrics
// CCXT provides real-time BTC/ETH prices from major exchanges
// CMC provides dominance %, market cap, 24h volume

import { safeFetch } from '../utils/fetch.mjs';

export async function briefing() {
  try {
    const [ccxtData, cmcData] = await Promise.all([
      fetchCCXTPrices(),
      fetchCoinMarketCap(process.env.CMC_API_KEY),
    ]);

    return {
      btc: ccxtData?.btc,
      eth: ccxtData?.eth,
      funding: ccxtData?.funding,
      dominance: cmcData?.btc_dominance,
      marketCap: cmcData?.total_market_cap,
      volume24h: cmcData?.total_volume_24h,
      timestamp: Date.now(),
    };
  } catch (e) {
    console.error('[Crypto] Error:', e.message);
    return null;
  }
}

async function fetchCCXTPrices() {
  try {
    // Import CCXT dynamically (it's optional)
    const ccxt = await import('ccxt');

    // Use Binance for spot prices (most liquid)
    const binance = new ccxt.default.binance();
    
    // Fetch both spot and funding together
    const [btcTicker, ethTicker, btcFunding] = await Promise.all([
      binance.fetchTicker('BTC/USDT'),
      binance.fetchTicker('ETH/USDT'),
      fetchBinanceFunding('BTCUSDT'),
    ]);

    return {
      btc: {
        price: btcTicker.last,
        change24h: btcTicker.percentage,
        volume: btcTicker.quoteVolume,
      },
      eth: {
        price: ethTicker.last,
        change24h: ethTicker.percentage,
        volume: ethTicker.quoteVolume,
      },
      funding: btcFunding,
      timestamp: Date.now(),
    };
  } catch (e) {
    console.warn('[CCXT] Fallback to REST API:', e.message);
    return fallbackSpotPrices();
  }
}

async function fetchBinanceFunding(symbol) {
  try {
    const res = await safeFetch('https://fapi.binance.com/fapi/v1/fundingRate', {
      searchParams: { symbol, limit: 1 },
      timeout: 5000,
    });
    return res?.[0]?.fundingRate ? parseFloat(res[0].fundingRate) : null;
  } catch {
    return null;
  }
}

async function fallbackSpotPrices() {
  // Fallback: use simple REST endpoints if CCXT unavailable
  try {
    const [btcRes, ethRes] = await Promise.all([
      safeFetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { timeout: 5000 }),
      safeFetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { timeout: 5000 }),
    ]);

    return {
      btc: { price: parseFloat(btcRes?.data?.amount), change24h: null },
      eth: { price: parseFloat(ethRes?.data?.amount), change24h: null },
      funding: null,
    };
  } catch (e) {
    console.warn('[Crypto] Fallback failed:', e.message);
    return null;
  }
}

async function fetchCoinMarketCap(apiKey) {
  if (!apiKey) return null; // Skip if no key
  
  try {
    const res = await safeFetch('https://pro-api.coinmarketcap.com/v1/global', {
      headers: { 'X-CMC_PRO_API_KEY': apiKey },
      timeout: 8000,
    });

    const data = res?.data || {};
    return {
      btc_dominance: data.btc_dominance?.toFixed(2),
      eth_dominance: data.eth_dominance?.toFixed(2),
      total_market_cap: data.quote?.USD?.total_market_cap,
      total_volume_24h: data.quote?.USD?.total_volume_24h,
      timestamp: Date.now(),
    };
  } catch (e) {
    console.warn('[CMC] Error:', e.message);
    return null;
  }
}
