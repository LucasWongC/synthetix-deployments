const assert = require('assert');
const { ethers } = require('ethers');
require('../../inspect');
const log = require('debug')(`e2e:${require('path').basename(__filename, '.e2e.js')}`);

const { getEthBalance } = require('../../tasks/getEthBalance');
const { setEthBalance } = require('../../tasks/setEthBalance');
const { getCollateralBalance } = require('../../tasks/getCollateralBalance');
const { getTokenBalance } = require('../../tasks/getTokenBalance');
const { isCollateralApproved } = require('../../tasks/isCollateralApproved');
const { approveCollateral } = require('../../tasks/approveCollateral');
const { setTokenBalance } = require('../../tasks/setTokenBalance');
const { syncTime } = require('../../tasks/syncTime');
const { setConfigUint } = require('../../tasks/setConfigUint');
const { getConfigUint } = require('../../tasks/getConfigUint');
const { wrapCollateral } = require('../../tasks/wrapCollateral');
const { unwrapCollateral } = require('../../tasks/unwrapCollateral');
const { spotSell } = require('../../tasks/spotSell');
const { spotBuy } = require('../../tasks/spotBuy');
const { getCollateralConfig } = require('../../tasks/getCollateralConfig');
const { doPriceUpdateForPyth } = require('../../tasks/doPriceUpdateForPyth');

describe(require('path').basename(__filename, '.e2e.js'), function () {
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL || 'http://127.0.0.1:8545'
  );
  const wallet = ethers.Wallet.createRandom().connect(provider);
  const address = wallet.address;
  const privateKey = wallet.privateKey;

  let snapshot;
  before('Create snapshot', async () => {
    snapshot = await provider.send('evm_snapshot', []);
    log('Create snapshot', { snapshot });
  });
  after('Restore snapshot', async () => {
    log('Restore snapshot', { snapshot });
    await provider.send('evm_revert', [snapshot]);
  });

  it('should sync time of the fork', async () => {
    await syncTime();
  });

  it('should disable withdrawal timeout', async () => {
    await setConfigUint({ key: 'accountTimeoutWithdraw', value: 0 });
    assert.equal(await getConfigUint('accountTimeoutWithdraw'), 0);
  });

  it('should create new random wallet', async () => {
    log({ wallet: wallet.address, pk: wallet.privateKey });
    assert.ok(wallet.address);
  });

  it('should set ETH balance to 100', async () => {
    assert.equal(await getEthBalance({ address }), 0, 'New wallet has 0 ETH balance');
    await setEthBalance({ address, balance: 100 });
    assert.equal(await getEthBalance({ address }), 100);
  });

  it('should set GHO balance to 1000', async () => {
    const { tokenAddress } = await getCollateralConfig('GHO');
    assert.equal(
      await getCollateralBalance({ address, symbol: 'GHO' }),
      0,
      'New wallet has 0 GHO balance'
    );
    await setTokenBalance({
      wallet,
      balance: 1_000,
      tokenAddress,
      friendlyWhale: '0xeBe517846d0F36eCEd99C735cbF6131e1fEB775D',
    });
    assert.equal(await getCollateralBalance({ address, symbol: 'GHO' }), 1000);
  });

  it('should approve GHO spending for SpotMarket', async () => {
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'GHO',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      false,
      'New wallet has not allowed SpotMarket GHO spending'
    );
    await approveCollateral({
      privateKey,
      symbol: 'GHO',
      spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
    });
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'GHO',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      true
    );
  });

  // it(`should do strict price update`, async () => {
  //   await doPriceUpdateForPyth({
  //     wallet,
  //     feedId: require('../../deployments/extras.json').pyth_feed_id_gho,
  //     priceVerificationContract: require('../../deployments/extras.json')
  //       .pyth_price_verification_address,
  //   });
  // });

  it(`should wrap 1000 GHO -> sGHO`, async () => {
    const synthBalance = await wrapCollateral({
      wallet,
      symbol: 'GHO',
      synthAddress: require('../../deployments/extras.json').synth_gho_token_address,
      synthMarketId: require('../../deployments/extras.json').synth_gho_market_id,
      amount: 1000,
    });
    assert.equal(synthBalance, 1000);
    assert.equal(
      await getTokenBalance({
        walletAddress: address,
        tokenAddress: require('../../deployments/extras.json').synth_gho_token_address,
      }),
      1000
    );
  });

  it('should swap 500 sgho -> USDx', async () => {
    assert.equal(await getCollateralBalance({ address, symbol: 'USDx' }), 0);
    await spotSell({
      wallet,
      marketId: require('../../deployments/extras.json').synth_gho_market_id,
      synthAmount: 500,
      minUsdAmount: 200,
    });
    assert.ok(
      (await getCollateralBalance({ address, symbol: 'USDx' })) >= 200,
      'USDx balance >= 200'
    );
  });

  it('should approve USDx spending for SpotMarket', async () => {
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'USDx',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      false,
      'New wallet has not allowed SpotMarket USDx spending'
    );
    await approveCollateral({
      privateKey,
      symbol: 'USDx',
      spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
    });
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'USDx',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      true
    );
  });

  it('should swap 200 USDx -> sGHO', async () => {
    await spotBuy({
      wallet,
      marketId: require('../../deployments/extras.json').synth_gho_market_id,
      usdAmount: 200,
      minAmountReceived: 50,
    });
    assert.ok(
      (await getTokenBalance({
        walletAddress: address,
        tokenAddress: require('../../deployments/extras.json').synth_gho_token_address,
      })) >=
        500 + 50,
      `sGHO balance >= ${500 + 50}`
    );
  });

  it(`should unwrap 500 sGHO -> GHO`, async () => {
    const synthBalance = await unwrapCollateral({
      wallet,
      symbol: 'GHO',
      synthAddress: require('../../deployments/extras.json').synth_gho_token_address,
      synthMarketId: require('../../deployments/extras.json').synth_gho_market_id,
      amount: 500,
    });
    assert.ok(synthBalance < 500);
    assert.equal(await getCollateralBalance({ address, symbol: 'GHO' }), 500);
  });
});
