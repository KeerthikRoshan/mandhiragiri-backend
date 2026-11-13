const test = require('node:test');
const assert = require('node:assert/strict');
const bookingModel = require('../src/models/bookingModel');
const bookingService = require('../src/services/bookingService');

test('Settlement Completion Workflow Unit & Service Tests', async (t) => {
  const originalCompleteSettlement = bookingModel.completeSettlement;
  const originalGetCompletedSettlements = bookingModel.getCompletedSettlements;

  t.after(() => {
    bookingModel.completeSettlement = originalCompleteSettlement;
    bookingModel.getCompletedSettlements = originalGetCompletedSettlements;
  });

  await t.test('completes client receivable and marks status as paid', async () => {
    bookingModel.completeSettlement = async ({ bookingId, party }) => {
      assert.equal(bookingId, '101');
      assert.equal(party, 'CLIENT');
      return {
        success: true,
        bookingId: '101',
        party: 'CLIENT',
        settledAmount: 5000,
        completedAt: new Date().toISOString()
      };
    };

    const res = await bookingService.completeSettlement('101', { party: 'CLIENT' }, { id: 1 });
    assert.equal(res.success, true);
    assert.equal(res.party, 'CLIENT');
    assert.equal(res.settledAmount, 5000);
  });

  await t.test('completes priest settlement and marks status as paid', async () => {
    bookingModel.completeSettlement = async ({ bookingId, party }) => {
      assert.equal(bookingId, '102');
      assert.equal(party, 'PRIEST');
      return {
        success: true,
        bookingId: '102',
        party: 'PRIEST',
        settledAmount: 3000,
        completedAt: new Date().toISOString()
      };
    };

    const res = await bookingService.completeSettlement('102', { party: 'PRIEST' }, { id: 1 });
    assert.equal(res.success, true);
    assert.equal(res.party, 'PRIEST');
    assert.equal(res.settledAmount, 3000);
  });

  await t.test('retrieves combined completed settlements for both priest and client', async () => {
    bookingModel.getCompletedSettlements = async () => [
      {
        id: 'client_101',
        bookingId: '101',
        bookingNumber: 'BK-101',
        dateKey: '2026-11-13',
        title: 'Ganapathi Homam',
        settlementType: 'CLIENT',
        personName: 'Ramesh',
        phone: '9840123456',
        totalAmount: 10000,
        previouslyPaidAmount: 5000,
        finalSettledAmount: 10000,
        completionDate: new Date().toISOString(),
        settlementStatus: 'completed'
      },
      {
        id: 'priest_102',
        bookingId: '102',
        bookingNumber: 'BK-102',
        dateKey: '2026-11-13',
        title: 'Navagraha Pooja',
        settlementType: 'PRIEST',
        personName: 'Swami Murugan',
        phone: null,
        totalAmount: 3000,
        previouslyPaidAmount: 1000,
        finalSettledAmount: 3000,
        completionDate: new Date().toISOString(),
        settlementStatus: 'completed'
      }
    ];

    const result = await bookingService.getCompletedSettlements({});
    assert.equal(result.count, 2);
    assert.equal(result.settlements[0].settlementType, 'CLIENT');
    assert.equal(result.settlements[1].settlementType, 'PRIEST');
  });
});
