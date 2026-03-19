// Crypto Market Data — CCXT spot prices + CoinMarketCap market metrics
// CCXT provides real-time BTC/ETH prices from major exchanges
// CMC provides dominance %, market cap, 24h volume

import { safeFetch } from '../utils/fetch.mjs';

export async function briefing() {
    try {
        const [ccxtData, cmcData] = await Promise.all([
            fetchCCXTPrices(),
            fetchCoinMarketCapListings(process.env.CMC_API_KEY),
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

        // Use Bitget for spot prices (reliable, not geo-blocked)
        const bitget = new ccxt.default.bitget();

        // Fetch BTC/ETH prices
        const [btcTicker, ethTicker] = await Promise.all([
            bitget.fetchTicker('BTC/USDT'),
            bitget.fetchTicker('ETH/USDT'),
        ]);

        console.log('[Crypto] CCXT (Bitget) succeeded');
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
            funding: null,
            timestamp: Date.now(),
        };
    } catch (e) {
        console.warn('[CCXT] Bitget failed, fallback to Coinbase:', e.message);
        return fallbackSpotPrices();
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

async function fetchCoinMarketCapListings(apiKey) {
    if (!apiKey) return null;

    try {
        const res = await safeFetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=5000&convert=USD&sort=market_cap', {
            headers: { 'X-CMC_PRO_API_KEY': apiKey },
            timeout: 8000,
        });

        const data = res?.data || [];
        if (!data.length) return null;

        // Calculate totals from all cryptos
        let totalMarketCap = 0;
        let totalVolume24h = 0;
        let btcMarketCap = 0;

        for (const crypto of data) {
            const quote = crypto.quote?.USD || {};
            totalMarketCap += quote.market_cap || 0;
            totalVolume24h += quote.volume_24h || 0;
            if (crypto.symbol === 'BTC') {
                btcMarketCap = quote.market_cap || 0;
                console.log(`[CMC-DEBUG] BTC quote keys: ${Object.keys(quote).join(', ')}`);
                console.log(`[CMC-DEBUG] BTC quote.market_cap: ${quote.market_cap}`);
                console.log(`[CMC-DEBUG] BTC quote.price: ${quote.price}`);
            }
        }

        const btcDominance = totalMarketCap > 0
            ? ((btcMarketCap / totalMarketCap) * 100).toFixed(2)
            : null;

        console.log(`[CMC] BTC: $${btcMarketCap}, Total: $${totalMarketCap}, Dominance: ${btcDominance}%`);
        console.log('[Crypto] CMC listings data succeeded');
        return {
            btc_dominance: btcDominance,
            total_market_cap: totalMarketCap,
            total_volume_24h: totalVolume24h,
            timestamp: Date.now(),
        };
    } catch (e) {
        console.warn('[CMC] Error:', e.message);
        return null;
    }
}
