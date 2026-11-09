const test = require('node:test');
const assert = require('node:assert/strict');
const bookingService = require('../src/services/bookingService');
const bookingModel = require('../src/models/bookingModel');

test('Financial Audits and Settlements unit tests', async (t) => {
  const originalGetFinancialAuditSummary = bookingModel.getFinancialAuditSummary;
  const originalGetClientReceivables = bookingModel.getClientReceivables;
  const originalGetPriestSettlements = bookingModel.getPriestSettlements;
  const originalGetFinancialAuditTransactions = bookingModel.getFinancialAuditTransactions;

  t.after(() => {
    bookingModel.getFinancialAuditSummary = originalGetFinancialAuditSummary;
    bookingModel.getClientReceivables = originalGetClientReceivables;
    bookingModel.getPriestSettlements = originalGetPriestSettlements;
    bookingModel.getFinancialAuditTransactions = originalGetFinancialAuditTransactions;
  });

  await t.test('calculates correct summary totals and net margin', async () => {
    bookingModel.getFinancialAuditSummary = async (filters) => ({
      totalBookings: 15,
      totalBilled: 150000,
      totalCollected: 100000,
      clientOutstanding: 50000,
      priestTotalDue: 45000,
      priestSettled: 30000,
      priestPendingSettlement: 15000,
      netPeedamMargin: 70000, // 100000 - 30000
      fullyPaidCount: 8,
      partialPaidCount: 5,
      pendingPaidCount: 2,
      priestSettledCount: 7,
      priestPendingCount: 8
    });

    bookingModel.getClientReceivables = async (filters) => [
      {
        id: '1',
        bookingNumber: 'BK-001',
        title: 'கணபதி ஹோமம்',
        clientName: 'ரமேஷ்',
        totalEventCharge: 10000,
        clientTotalReceived: 4000,
        clientBalanceAmount: 6000,
        clientPaymentStatus: 'partial'
      }
    ];

    const result = await bookingService.getFinancialAuditSummary({ month: '2026-11' });

    assert.equal(result.summary.totalBilled, 150000);
    assert.equal(result.summary.totalCollected, 100000);
    assert.equal(result.summary.clientOutstanding, 50000);
    assert.equal(result.summary.priestTotalDue, 45000);
    assert.equal(result.summary.priestSettled, 30000);
    assert.equal(result.summary.priestPendingSettlement, 15000);
    assert.equal(result.summary.netPeedamMargin, 70000);
    assert.equal(result.count, 1);
    assert.equal(result.receivables[0].clientBalanceAmount, 6000);
  });

  await t.test('retrieves priest compensation settlements properly', async () => {
    bookingModel.getPriestSettlements = async (filters) => [
      {
        priestId: '2',
        priestName: 'முருகன்',
        priestNameTamil: 'முருகன்',
        phone: '9840123456',
        bookingCount: 5,
        totalPay: 25000,
        advancePaid: 15000,
        balanceDue: 10000,
        settlementStatus: 'partial'
      }
    ];

    const result = await bookingService.getPriestSettlements({});
    assert.equal(result.count, 1);
    assert.equal(result.settlements[0].priestName, 'முருகன்');
    assert.equal(result.settlements[0].balanceDue, 10000);
  });

  await t.test('retrieves audit transactions ledger with correct mapping', async () => {
    bookingModel.getFinancialAuditTransactions = async (filters) => [
      {
        id: '10',
        bookingId: '1',
        bookingNumber: 'BK-001',
        title: 'கணபதி ஹோமம்',
        clientName: 'ரமேஷ்',
        party: 'client',
        amount: 4000,
        paymentMethod: 'cash',
        transactionType: 'ADVANCE',
        paidAt: '2026-11-07T10:00:00.000Z'
      }
    ];

    const result = await bookingService.getFinancialAuditTransactions({ limit: 10 });
    assert.equal(result.count, 1);
    assert.equal(result.transactions[0].amount, 4000);
    assert.equal(result.transactions[0].party, 'client');
  });
});
