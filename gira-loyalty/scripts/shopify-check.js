import { runShopifyCheck } from '../src/shopify/check-command.js';

process.exitCode = await runShopifyCheck({ args: process.argv.slice(2) });
