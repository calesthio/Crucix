// Test Feishu Alerter — Verify webhook connectivity and card rendering
// Usage: node test-feishu.mjs

import { FeishuAlerter } from './lib/alerts/feishu.mjs';

const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
const secret = process.env.FEISHU_SECRET;

if (!webhookUrl) {
  console.error('❌ FEISHU_WEBHOOK_URL not set in .env');
  process.exit(1);
}

console.log('🧪 Testing Feishu Alerter...\n');

const alerter = new FeishuAlerter({ webhookUrl, secret });

// Test 1: Plain text message
console.log('📝 Test 1: Plain text message');
const textResult = await alerter.sendMessage('🔴 CRUCIX TEST: Plain text message from test-feishu.mjs');
console.log(textResult ? '✅ Plain text sent' : '❌ Plain text failed');

// Test 2: Rich card message
console.log('\n📝 Test 2: Rich card message (FLASH alert)');
const testEvaluation = {
  shouldAlert: true,
  tier: 'FLASH',
  confidence: 'HIGH',
  headline: 'Test FLASH Alert',
  reason: 'This is a test alert to verify Feishu card rendering.',
  actionable: 'Verify card display in Feishu.',
  signals: ['test_signal_1', 'test_signal_2'],
  crossCorrelation: 'test correlation',
};

const testDelta = {
  summary: {
    direction: 'escalating',
    totalChanges: 5,
    criticalChanges: 2,
  },
};

const card = alerter._buildAlertCard(testEvaluation, testDelta, 'FLASH');
const cardResult = await alerter.sendMessage(null, card);
console.log(cardResult ? '✅ Rich card sent' : '❌ Rich card failed');

// Test 3: PRIORITY tier
console.log('\n📝 Test 3: PRIORITY tier card');
const priorityEval = {
  ...testEvaluation,
  tier: 'PRIORITY',
  headline: 'Test PRIORITY Alert',
  confidence: 'MEDIUM',
};
const priorityCard = alerter._buildAlertCard(priorityEval, testDelta, 'PRIORITY');
const priorityResult = await alerter.sendMessage(null, priorityCard);
console.log(priorityResult ? '✅ PRIORITY card sent' : '❌ PRIORITY card failed');

// Test 4: ROUTINE tier
console.log('\n📝 Test 4: ROUTINE tier card');
const routineEval = {
  ...testEvaluation,
  tier: 'ROUTINE',
  headline: 'Test ROUTINE Alert',
  confidence: 'LOW',
};
const routineCard = alerter._buildAlertCard(routineEval, testDelta, 'ROUTINE');
const routineResult = await alerter.sendMessage(null, routineCard);
console.log(routineResult ? '✅ ROUTINE card sent' : '❌ ROUTINE card failed');

console.log('\n🎉 Feishu Alerter test complete');
console.log('Check your Feishu group to verify all 4 messages were received correctly.');
