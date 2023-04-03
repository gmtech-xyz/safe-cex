## [2.1.3](https://github.com/gmtech-xyz/safe-cex/compare/v2.1.2...v2.1.3) (2023-04-03)


### Bug Fixes

* **binance:** dont set `reduceOnly` when posting SL/TP ([b82d426](https://github.com/gmtech-xyz/safe-cex/commit/b82d426c2eb0393ceb59c33e7a1089a534eed4ed))


### Features

* **exchange:** improve latency calc precision ([09f8fd7](https://github.com/gmtech-xyz/safe-cex/commit/09f8fd74f6844087308ce13a35632658ddda704b))



## [2.1.2](https://github.com/gmtech-xyz/safe-cex/compare/v2.1.1...v2.1.2) (2023-03-31)

### Bug Fixes

- **woo:** dont cancel algo orders ([3a38eaa](https://github.com/gmtech-xyz/safe-cex/commit/3a38eaa38a3cdad75bbcc6f363898a5392d84709))

## [2.1.1](https://github.com/gmtech-xyz/safe-cex/compare/v2.1.0...v2.1.1) (2023-03-31)

### Features

- **woo:** add latency mesure ([1aa9f3a](https://github.com/gmtech-xyz/safe-cex/commit/1aa9f3a20b9d0097a0bcadd2aad24b15cd81c628))

# [2.1.0](https://github.com/gmtech-xyz/safe-cex/compare/v2.0.0...v2.1.0) (2023-03-31)

### Bug Fixes

- **binance:** missing closing ws ([b72a62b](https://github.com/gmtech-xyz/safe-cex/commit/b72a62b4781da73a1c250be644ba8f332db42eae))
- **woo:** api v1 usage ([81d7eeb](https://github.com/gmtech-xyz/safe-cex/commit/81d7eeba3d81e0ada5562d1aea3f23296eb74821))
- **woo:** cancel order, catch err if already removed ([4429f77](https://github.com/gmtech-xyz/safe-cex/commit/4429f77220f01b12ff8f8783f13a65d84bd16741))
- **woo:** inverse volume & quoteVolume keys ([0d58047](https://github.com/gmtech-xyz/safe-cex/commit/0d58047fb67bb86ed4e4c743ba8ccc8cdf6ab145))
- **woo:** positional sl/tp better handling ([9fec937](https://github.com/gmtech-xyz/safe-cex/commit/9fec937090b8c7e5c8a9a0a7597e0258d9ac99e4))
- **woo:** support fill event on algo orders ([0df8856](https://github.com/gmtech-xyz/safe-cex/commit/0df8856914d1fdaa8f550d64db0d2d2a88f168a6))

### Features

- **exchanges:** bootstrap woo ([5b0735f](https://github.com/gmtech-xyz/safe-cex/commit/5b0735f408fe21bc7ca642faa838b68178868840))
- **woo:** add cancel orders ([fde1f99](https://github.com/gmtech-xyz/safe-cex/commit/fde1f99af8f525649f421790142e7d0e438ed155))
- **woo:** add cancel orders methods ([aac0480](https://github.com/gmtech-xyz/safe-cex/commit/aac0480fbac84ff6ef1a0fe3e1648091c00fa4a0))
- **woo:** add fetchOHLCV ([30977bf](https://github.com/gmtech-xyz/safe-cex/commit/30977bf58c4055404b91020bdeaa7c4a64e8e2da))
- **woo:** add listen ohlcv ([f8bab14](https://github.com/gmtech-xyz/safe-cex/commit/f8bab14a58ed16ed08f1491fb8898d422720e060))
- **woo:** add update leverage ([4ff6571](https://github.com/gmtech-xyz/safe-cex/commit/4ff6571ac116027f6b17f9c9d66a3be7fed41790))
- **woo:** bootstrap `placeOrder` ([ee42293](https://github.com/gmtech-xyz/safe-cex/commit/ee42293441af377dde76dc46f6b6b72eb5d8e429))
- **woo:** fetch orders ([e817dc2](https://github.com/gmtech-xyz/safe-cex/commit/e817dc2bde9c8008230d84213688af69221b8586))
- **woo:** handle `executionreport` events ([2818258](https://github.com/gmtech-xyz/safe-cex/commit/28182587e7d5422e0ef60b464c6d582d3a969cea))
- **woo:** include broker_id ([7e8c1bb](https://github.com/gmtech-xyz/safe-cex/commit/7e8c1bb97c3a397c03dda5f513fae8778467635b))
- **woo:** normalize symbol ([5cdcf39](https://github.com/gmtech-xyz/safe-cex/commit/5cdcf39ab1ec4105ca0f8053077b9c06efbccf96))
- **woo:** place position SL/TP on create ([157d010](https://github.com/gmtech-xyz/safe-cex/commit/157d010b35decf648f2a2e9567238e4e7b26c8db))
- **woo:** support trailing stops ([574d500](https://github.com/gmtech-xyz/safe-cex/commit/574d500b1d5eafd82e3e8c34a97019db539e9432))
- **woo:** support update of tsl updates ([d081c0e](https://github.com/gmtech-xyz/safe-cex/commit/d081c0e1963a860e90757a39009e180a662ab73e))
- **woo:** update algo orders & listen private updates ([2a018ec](https://github.com/gmtech-xyz/safe-cex/commit/2a018ec97ea48f5273f7598e63df98ee90e877ec))
- **ws:** connect after markets and tickers ([4aae18c](https://github.com/gmtech-xyz/safe-cex/commit/4aae18c6b71e2108e33bff7221464f6307b0e436))
- **ws:** improve memory ([fe0928e](https://github.com/gmtech-xyz/safe-cex/commit/fe0928ebf65e0eb84221e411133352dee9e007af))
- **ws:** log when disconnected ([ad59129](https://github.com/gmtech-xyz/safe-cex/commit/ad5912998d8a07d5dedd74ef36f4ad61afd101bb))

# [2.0.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.5...v2.0.0) (2023-03-27)

### Features

- **hedge-mode:** dont set hedge mode automatically ([b404bf1](https://github.com/gmtech-xyz/safe-cex/commit/b404bf1467600c6eb1e1080b2bd214a353e329b9))

## [1.6.5](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.4...v1.6.5) (2023-03-24)

### Bug Fixes

- **exchanges:** report latency with ping ([c7d7809](https://github.com/gmtech-xyz/safe-cex/commit/c7d7809537a183982591853292ab59a14538442a))

## [1.6.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.3...v1.6.4) (2023-03-24)

### Bug Fixes

- **bybit:** ask/bid keys in ws ([7c337eb](https://github.com/gmtech-xyz/safe-cex/commit/7c337eb68cf97cdab0607c48a54ddfd00d29f5c6))

## [1.6.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.0...v1.6.3) (2023-03-24)

### Bug Fixes

- **bybit:** tickers ask price ([6da00b8](https://github.com/gmtech-xyz/safe-cex/commit/6da00b8b9cb59350bb249c8169e10049bc46dff9))
- **bybit:** use `X-Referer` ([a53f92d](https://github.com/gmtech-xyz/safe-cex/commit/a53f92d76de998d52a11e67280b672678b83426d))

### Features

- **bybit:** add broker id ([f0eaf2f](https://github.com/gmtech-xyz/safe-cex/commit/f0eaf2fcce4192fd1252c99134c6626e738fa42f))

# [1.6.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.5.0...v1.6.0) (2023-03-21)

### Features

- **bybit:** use websocket from tickers data ([51181eb](https://github.com/gmtech-xyz/safe-cex/commit/51181eba2021f5bc37c6c83474b6c4634c626b6a))

# [1.5.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.4.0...v1.5.0) (2023-03-21)

### Features

- **binance:** use websocket for tickers data poll ([497dc2f](https://github.com/gmtech-xyz/safe-cex/commit/497dc2f296f94003ea2c9d119de0d467cdde529e))

# [1.4.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.5...v1.4.0) (2023-03-17)

### Features

- **binance:** support trailing stops ([0434664](https://github.com/gmtech-xyz/safe-cex/commit/04346642d3a1a466f03ba785ba221caae5e93204))
- **bybit:** place trailing stop loss ([3f4aafb](https://github.com/gmtech-xyz/safe-cex/commit/3f4aafba15b17f1a8a1d65198369e0e7d2469579))

## [1.3.5](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.4...v1.3.5) (2023-03-17)

### Bug Fixes

- **exchanges:** tick when page in background ([900fbde](https://github.com/gmtech-xyz/safe-cex/commit/900fbde441b9a3bfe10f7043bed8b0f496c62f4a))

## [1.3.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.3...v1.3.4) (2023-03-15)

### Features

- **validateAccount:** return exchange error ([9b4b6cf](https://github.com/gmtech-xyz/safe-cex/commit/9b4b6cfb6a432860de9de778ab511653b7f83a14))

## [1.3.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.2...v1.3.3) (2023-03-14)

### Features

- **binance:** use `positionRisk` endpoint for liq price ([38d1947](https://github.com/gmtech-xyz/safe-cex/commit/38d19473937ea6779f6fa189301d1534fb0135b0))

## [1.3.2](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.1...v1.3.2) (2023-03-14)

### Bug Fixes

- **binance:** filter out positions not matching a market ([0dedf25](https://github.com/gmtech-xyz/safe-cex/commit/0dedf2576deba272ea7118187c0ed431b484be6e))

## [1.3.1](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.0...v1.3.1) (2023-03-06)

### Bug Fixes

- **order:** store and set `reduceOnly` on update ([aa8f353](https://github.com/gmtech-xyz/safe-cex/commit/aa8f35369351e38b14baee5a5443189a89f49729))

# [1.3.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.5...v1.3.0) (2023-03-06)

### Bug Fixes

- **bybit.updateOrder:** return correct orderIds ([53a1fee](https://github.com/gmtech-xyz/safe-cex/commit/53a1feed2982ed9882e01587115c3596ed6de1f2))

### Features

- **placeOrder:** accept `timeInForce` option ([38a3f06](https://github.com/gmtech-xyz/safe-cex/commit/38a3f062b459509982215e3f12ab3c4e4376e0f5))
- **placeOrder:** returns array of orderIds ([7c200dc](https://github.com/gmtech-xyz/safe-cex/commit/7c200dc0b465e8a71c89bed9bafaf8c304efb1ed))
- **updateOrder:** return string[] of orderIds ([a2c64d6](https://github.com/gmtech-xyz/safe-cex/commit/a2c64d6e190704f632656e8b715a037a4009c31f))

## [1.2.5](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.4...v1.2.5) (2023-03-03)

### Bug Fixes

- **binance:** batch delete orders ([95587fd](https://github.com/gmtech-xyz/safe-cex/commit/95587fd0ca5fb6957dfa2fe2c992877ede946676))

### Features

- **binance:** emit error from cancel orders ([a85d8aa](https://github.com/gmtech-xyz/safe-cex/commit/a85d8aa297bd78113deabcea362e5a0c516988b3))

## [1.2.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.3...v1.2.4) (2023-03-03)

### Bug Fixes

- **bybit:** dont duplicate SL/TP on split orders ([beaa657](https://github.com/gmtech-xyz/safe-cex/commit/beaa65749ea2228ba61fdb674228deb634acee18))

## [1.2.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.2...v1.2.3) (2023-03-02)

### Features

- **exchange:** emit error on `validateAccount` ([86618ec](https://github.com/gmtech-xyz/safe-cex/commit/86618ec38ce42b5e73b8a64394569e9af3580f53))

## [1.2.2](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.0...v1.2.2) (2023-03-02)

### Bug Fixes

- **virtual-clock:** call `https` api ([c955cf1](https://github.com/gmtech-xyz/safe-cex/commit/c955cf1a5772124f1dc7719f3b8a7e4c45762cea))
- **virtual-clock:** start when create exchange, fallback APIs ([ad4b287](https://github.com/gmtech-xyz/safe-cex/commit/ad4b2872468ea6c8ecadf9c843c9c6016dd0aff1))

# [1.2.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.1.1...v1.2.0) (2023-02-28)

### Features

- **exchanges.api:** use server time for creating requests ([7c5ebdd](https://github.com/gmtech-xyz/safe-cex/commit/7c5ebddfd4a4b4442956e6b58845e1627ddf194d))
- **virtualclock:** use virtual clock with server time ([6cc98b5](https://github.com/gmtech-xyz/safe-cex/commit/6cc98b526630d0d3af9b66a8021a215531b13adb))

## [1.1.1](https://github.com/gmtech-xyz/safe-cex/compare/v1.1.0...v1.1.1) (2023-02-27)

### Bug Fixes

- **bybit:** condition for creating hedged tickers map ([495e126](https://github.com/gmtech-xyz/safe-cex/commit/495e12626ba5cfd513add27c4aebdcb0635e29e3))

# [1.1.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.4...v1.1.0) (2023-02-27)

### Features

- **binance:** support non-hedged mode ([82a1265](https://github.com/gmtech-xyz/safe-cex/commit/82a1265a1595a8f272af5860f2ebb51011b14ad8))
- **bybit:** support non-hedge mode ([ffe190b](https://github.com/gmtech-xyz/safe-cex/commit/ffe190b6779f69df55b897be3a25f0bcef0021c5))

## [1.0.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.3...v1.0.4) (2023-02-22)

### Features

- **log:** emit log messages ([6dd5f89](https://github.com/gmtech-xyz/safe-cex/commit/6dd5f8928d9865328fbb9d5a2cb2522847007271))

## [1.0.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.2...v1.0.3) (2023-02-21)

### Bug Fixes

- **bybit:** doesnt need CORS-Anywhere anymore ([fad87a9](https://github.com/gmtech-xyz/safe-cex/commit/fad87a9c742b3a30acaae7036ab042e022c88393))

## [1.0.2](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.1...v1.0.2) (2023-02-21)

## [1.0.1](https://github.com/gmtech-xyz/safe-cex/compare/05c24aeb35ee0e678f906d5b9637e4512b31ad30...v1.0.1) (2023-02-21)

### Features

- **safe-cex:** update code from tuleep ([05c24ae](https://github.com/gmtech-xyz/safe-cex/commit/05c24aeb35ee0e678f906d5b9637e4512b31ad30))
