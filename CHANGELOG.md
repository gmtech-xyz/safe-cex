## [6.0.4](https://github.com/gmtech-xyz/safe-cex/compare/v2.1.3...v6.0.4) (2023-04-27)


### Bug Fixes

* **afterDecimals:** support exponential ([3331f8e](https://github.com/gmtech-xyz/safe-cex/commit/3331f8e4e0b4f0fa0c093989c5925af4cb150c65))
* **baseStore:** wrong idx check ([8951b30](https://github.com/gmtech-xyz/safe-cex/commit/8951b306180150519ec0f965b3ec1b784704d3ae))
* **binance:** remove cancelled orders ([811e0c0](https://github.com/gmtech-xyz/safe-cex/commit/811e0c0f5f0de61c0a81f82141ec74c81626e321))
* **bybit:** dont remove orders from store manually ([ec5082c](https://github.com/gmtech-xyz/safe-cex/commit/ec5082c1f6320a11a024955b294e382d59214d33))
* **bybit:** positionIdx for one-way positional SL/TP ([7c5efad](https://github.com/gmtech-xyz/safe-cex/commit/7c5efad72183a4c10c684d0f3c9c9e9506c893b4))
* **bybit:** timestamp closer to xhr ([de1e9f7](https://github.com/gmtech-xyz/safe-cex/commit/de1e9f72f03621322e2a8b49ba1edf5456a3bbc0))
* **defaultStore:** reset use a new object ([2fe682e](https://github.com/gmtech-xyz/safe-cex/commit/2fe682e8acd50cc1686591a40debf9f2d7b32116))
* **exchanges:** revert latency calc to ping ([b19644c](https://github.com/gmtech-xyz/safe-cex/commit/b19644c8357f8323f8fdded2b31b80c84b12615c))
* **gat.ws-private:** apply `math.abs` on fill size ([0f11485](https://github.com/gmtech-xyz/safe-cex/commit/0f1148562efe07f3080ddb6fe129c5c36441d874))
* **gate:** better error emit ([1da2ff3](https://github.com/gmtech-xyz/safe-cex/commit/1da2ff3af34d9dbb4c1134fcdb6520cc24168053))
* **okx.ohlcv:** fix timeframes ([202e789](https://github.com/gmtech-xyz/safe-cex/commit/202e789d7abfcc9d4996f1ba8e831876bbc38cab))
* **okx.ws-private:** fill event ([02f94f1](https://github.com/gmtech-xyz/safe-cex/commit/02f94f13cd7925acfe5cc020d55e4ffad267c780))
* **okx.ws-private:** listen for TSL ([9f918ce](https://github.com/gmtech-xyz/safe-cex/commit/9f918ce46bd6fcd15f890f6292f2ea2d0b28db05))
* **okx.ws-public:** retry until markets are fetched ([35ea769](https://github.com/gmtech-xyz/safe-cex/commit/35ea7698597838bac31b8a990c5a7af862f624a4))
* **okx/orderbook:** remove bids/asks out of reach ([8c54791](https://github.com/gmtech-xyz/safe-cex/commit/8c547911186b86f30fbc92a5f4ce16fe5ae6a124))
* **okx:** balance total calc ([57f20b7](https://github.com/gmtech-xyz/safe-cex/commit/57f20b7e19bf0e9658fb16e9681eb527253119ca))
* **okx:** clientOrderId max len ([fed346f](https://github.com/gmtech-xyz/safe-cex/commit/fed346f3f2ba2453ceecf731671c19dd36e7dbad))
* **okx:** dont show algo order if triggerPrice is 0 ([040e35e](https://github.com/gmtech-xyz/safe-cex/commit/040e35e4fda6ae05ac7286c2fc71f17a1a94166c))
* **okx:** fetch leverage before positions ([185d6f5](https://github.com/gmtech-xyz/safe-cex/commit/185d6f5773400f7da44c26e84c11349aad40d399))
* **okx:** fetch only linear markets ([de06e77](https://github.com/gmtech-xyz/safe-cex/commit/de06e77ed8591160cc035f721365efa051d9b4d1))
* **okx:** need to use proxy ([93b31b1](https://github.com/gmtech-xyz/safe-cex/commit/93b31b13d7a919e686934920e2ee4912eb81ff62))
* **okx:** ohlcv timestamp ([e8954cc](https://github.com/gmtech-xyz/safe-cex/commit/e8954ccf837af889c0cc13199ef5b5b1784b4c3d))
* **okx:** place order adjust size ([1d13a4a](https://github.com/gmtech-xyz/safe-cex/commit/1d13a4a39ae03dc0db160f3dcbc8d7e328cc62ec))
* **okx:** place orders, display positions in hedge mode ([91a1dc4](https://github.com/gmtech-xyz/safe-cex/commit/91a1dc4094319a103e9abd2ff69316a84587ff00))
* **okx:** place postional TP/SL as algo order ([32ad2fe](https://github.com/gmtech-xyz/safe-cex/commit/32ad2fe2d5ab0863a4c9ad0ae780f0cf2b985f7d))
* **okx:** place SL/TP in hedge mode ([cb2f8d7](https://github.com/gmtech-xyz/safe-cex/commit/cb2f8d7219165b41969e6c94dda8eab7603164d5))
* **okx:** prevent create order if size too small ([adc5c2b](https://github.com/gmtech-xyz/safe-cex/commit/adc5c2b3d6b35b2e381c7aa9b09c22c6cc6cd902))
* **okx:** resubscribe kline/orderbook on close ([c46c121](https://github.com/gmtech-xyz/safe-cex/commit/c46c1219b31d8c47078fb4e933d0b11dc8dd3b97))
* **okx:** set leverage ([d46711c](https://github.com/gmtech-xyz/safe-cex/commit/d46711c43458d93e357149e16b0295e68e7fa5c3))
* **okx:** trailing stops ([cc9036a](https://github.com/gmtech-xyz/safe-cex/commit/cc9036adb401dace05ea5a0817ccea541380703f))
* **orderbook:** clear timeout, check if disposed after snapshot ([27dc929](https://github.com/gmtech-xyz/safe-cex/commit/27dc92914ead0496174604a3e8e34ff55b4fdc34))
* **safe-math:** need to round with `adjust()` ([d5fc628](https://github.com/gmtech-xyz/safe-cex/commit/d5fc6284babed44231fe8febe0ef48cca2bbd4e5))
* **safe-math:** remove memoize, its a memory leak ([9277dd2](https://github.com/gmtech-xyz/safe-cex/commit/9277dd2bdef0ac1b328367a5b36db1dcb4b9484f))
* **store:** updatePositions ([dcd701d](https://github.com/gmtech-xyz/safe-cex/commit/dcd701de2e7b18852226c9f35fc4f08e5339592d))
* **store:** use proxy from valtio ([998b3ee](https://github.com/gmtech-xyz/safe-cex/commit/998b3ee50574c9a4bb3baa8e1f66ee82be332d14))
* **virtual-clock:** enforce smaller timediff ([226123e](https://github.com/gmtech-xyz/safe-cex/commit/226123eb7f068675473405143a091bb3b32c6f5c))
* **virtual-clock:** return dayjs obj ([563eab4](https://github.com/gmtech-xyz/safe-cex/commit/563eab4176fb4766020c7994b321b70ae9164003))
* **woo:** apply rate limitter on every calls ([70095bd](https://github.com/gmtech-xyz/safe-cex/commit/70095bd2900a7f2e91b509acca39d7bd2d2e6f5f))
* **woo:** balance calculation ([897891c](https://github.com/gmtech-xyz/safe-cex/commit/897891cf7cc35de21de66b2a3828b3c82cbad360))
* **woo:** dont crash when couldnt find market of filled order ([fa0c3c3](https://github.com/gmtech-xyz/safe-cex/commit/fa0c3c3001012076f89759ed2a8b421fa99bd628))
* **woo:** incorrect total balance calc ([1a86b33](https://github.com/gmtech-xyz/safe-cex/commit/1a86b33c0240acc3cc49fe3a958c7cb3458a7ce5))
* **woo:** use `brokerId` for V3 API Endpoint ([b9e1c23](https://github.com/gmtech-xyz/safe-cex/commit/b9e1c233df8a504fa19ae974936706b5715b88ae))
* **ws:** delete handler asap ([514c699](https://github.com/gmtech-xyz/safe-cex/commit/514c699a512c722f05bdb8b4fa2e7f093c457631))


### Features

* **binance:** add `listenOrderBook` ([1779ae9](https://github.com/gmtech-xyz/safe-cex/commit/1779ae917e46cf5a72194cca4ff8cbbae3867943))
* **bybit-ws-public:** re-subscribe topics on disconnect ([e56a138](https://github.com/gmtech-xyz/safe-cex/commit/e56a1389bd4d5ffe749cdb6555962cdbd769bb12))
* **bybit:** add `listenOrderBook` ([db314bf](https://github.com/gmtech-xyz/safe-cex/commit/db314bf0bc0ca2c735acc874cee48295dfe6bc65))
* **bybit:** emit error if any on update positional TP/SL ([5d5aba2](https://github.com/gmtech-xyz/safe-cex/commit/5d5aba2f9e7697186a628a60ddefd89a90bedbaa))
* **bybit:** retry signature errors ([83d53ec](https://github.com/gmtech-xyz/safe-cex/commit/83d53ec5291d33b7440cebc6e4698d97dc25f6a6))
* **exchange:** make store overridable ([ab23d2f](https://github.com/gmtech-xyz/safe-cex/commit/ab23d2f5c883d857650e61a9bd9bb44879a0419c))
* **gate:** support hedge mode ([83a4bf5](https://github.com/gmtech-xyz/safe-cex/commit/83a4bf563b608bbe6aa2c66a590f03a77b459a44))
* **okx.placeOrder:** add support position TP/SL ([b8e2c4f](https://github.com/gmtech-xyz/safe-cex/commit/b8e2c4f89c7a99468320cf0dfec4417b3be953ca))
* **okx.ws-private:** listen balance ([0d34072](https://github.com/gmtech-xyz/safe-cex/commit/0d34072c611902bfc2709c97d9e2fe92732cd24d))
* **okx.ws-private:** listen positions ([b29d856](https://github.com/gmtech-xyz/safe-cex/commit/b29d856079f50d0efd03005730b6c6bc532a2667))
* **okx.ws-private:** listen to order updates ([b64059d](https://github.com/gmtech-xyz/safe-cex/commit/b64059d8a4840e188697debb5654693fdf4d1793))
* **okx.ws-public:** add indexPrice && markPrice ([0339b87](https://github.com/gmtech-xyz/safe-cex/commit/0339b87c3c29ca06ec342f7586486be775845923))
* **okx.ws-public:** add ping ([e92ea7c](https://github.com/gmtech-xyz/safe-cex/commit/e92ea7c54167716050760dfba93b6f00f4f8e454))
* **okx:** add broker_id ([b66a646](https://github.com/gmtech-xyz/safe-cex/commit/b66a6460b7b170e346a8a152fccaa21db9290687))
* **okx:** add listenOHLCV ([65ac2d7](https://github.com/gmtech-xyz/safe-cex/commit/65ac2d76a371d011c6cc5f749745ea61434b0b12))
* **okx:** add listenOrderBook ([997e149](https://github.com/gmtech-xyz/safe-cex/commit/997e149c45eb1835bc05efe581ac0df4e9d72f1f))
* **okx:** add oi and funding ([db3a32a](https://github.com/gmtech-xyz/safe-cex/commit/db3a32ac4c25652720fd9cc8580de1c6c7b75081))
* **okx:** add place simple orders ([08f473f](https://github.com/gmtech-xyz/safe-cex/commit/08f473fdceaec08513bd64a7240d1a1b93a1a0e6))
* **okx:** bootstrap ([7597e2c](https://github.com/gmtech-xyz/safe-cex/commit/7597e2ce7d74d2f09fb8d7aeb0332787a2f7d925))
* **okx:** bootstrap public ws ([1460ccf](https://github.com/gmtech-xyz/safe-cex/commit/1460ccf5b6aa8966d4b719f49460415380b59872))
* **okx:** cancel algo orders ([dbc94ea](https://github.com/gmtech-xyz/safe-cex/commit/dbc94ea3eba3702e72c44de43efed319bfe4ec6e))
* **okx:** cancel orders ([e78c056](https://github.com/gmtech-xyz/safe-cex/commit/e78c056587101c8c51e7e280e59cc79ceed0f159))
* **okx:** fetch algo orders ([a342023](https://github.com/gmtech-xyz/safe-cex/commit/a3420239d5547b11f80346e6a8caed7154991b84))
* **okx:** fetch conditional orders ([c8b681a](https://github.com/gmtech-xyz/safe-cex/commit/c8b681a7c3d996e2e12ebaa8d1416cfab4c3eacb))
* **okx:** fetch tickers, balance and positions ([6a608c0](https://github.com/gmtech-xyz/safe-cex/commit/6a608c0b679ace0d9a491f33e65289a94ce1ea50))
* **okx:** fetch/update position mode ([543035f](https://github.com/gmtech-xyz/safe-cex/commit/543035f5e9e3181b4be6d82de6f848f72d84607c))
* **okx:** fetchOHLCV ([345a0d7](https://github.com/gmtech-xyz/safe-cex/commit/345a0d70bd2f548c5c9ae8100717985ff8445f2b))
* **okx:** implement `batchOrders` ([dad1db6](https://github.com/gmtech-xyz/safe-cex/commit/dad1db6c578fe29c2baaeb5cde00046d1e4c6ced))
* **okx:** load simple orders ([6a4e728](https://github.com/gmtech-xyz/safe-cex/commit/6a4e7283e50227097364523e738d3e26dc280e9c))
* **okx:** place algo orders ([6decc6c](https://github.com/gmtech-xyz/safe-cex/commit/6decc6cd000665bb31e63312f8a9717ad168b52c))
* **okx:** support leverage ([f387b8e](https://github.com/gmtech-xyz/safe-cex/commit/f387b8e1582c1f0cd72450376322bec802ab6387))
* **okx:** update orders and algo orders ([4d6447d](https://github.com/gmtech-xyz/safe-cex/commit/4d6447de19da9878a8ccae4b575627a2d91b491e))
* **okx:** validate account ([5609bcf](https://github.com/gmtech-xyz/safe-cex/commit/5609bcf6cd301f1f01ca305cee229a51cece7565))
* **store:** remove valtio as it wasnt the fix ([0dcb52b](https://github.com/gmtech-xyz/safe-cex/commit/0dcb52b804fb1d91d9961877add1b259e771032c))
* **store:** use agnostic implementation ([6b2f891](https://github.com/gmtech-xyz/safe-cex/commit/6b2f8912a36a47355f6e3587d007487b8fa99c4a))
* **utils:** add clone ([88fa847](https://github.com/gmtech-xyz/safe-cex/commit/88fa8475352cf9681886c710c0ca95cdda2e53bf))
* **virtual-clock:** rely on computer date ([473003d](https://github.com/gmtech-xyz/safe-cex/commit/473003de499fd0c0ea55457dbc62e3c613b3f350))
* **woo:** add listenOrderBook ([4c1c216](https://github.com/gmtech-xyz/safe-cex/commit/4c1c2160bfc217be0f304d3494e50cfe50a1a4e0))


### Reverts

* Revert "feat(fetcOHLCV): allow fetch historical data" ([4ee6d6c](https://github.com/gmtech-xyz/safe-cex/commit/4ee6d6cba05386f182fa22ba571bed6d952c70bf))
* Revert "fixed page index (#5)" ([1c42d74](https://github.com/gmtech-xyz/safe-cex/commit/1c42d74236d0f1344e704b0ee41decbb07d104f0)), closes [#5](https://github.com/gmtech-xyz/safe-cex/issues/5)



## [2.1.3](https://github.com/gmtech-xyz/safe-cex/compare/v2.1.2...v2.1.3) (2023-04-03)


### Bug Fixes

* **binance:** dont set `reduceOnly` when posting SL/TP ([b82d426](https://github.com/gmtech-xyz/safe-cex/commit/b82d426c2eb0393ceb59c33e7a1089a534eed4ed))


### Features

* **exchange:** improve latency calc precision ([09f8fd7](https://github.com/gmtech-xyz/safe-cex/commit/09f8fd74f6844087308ce13a35632658ddda704b))



## [2.1.2](https://github.com/gmtech-xyz/safe-cex/compare/v2.1.1...v2.1.2) (2023-03-31)


### Bug Fixes

* **woo:** dont cancel algo orders ([3a38eaa](https://github.com/gmtech-xyz/safe-cex/commit/3a38eaa38a3cdad75bbcc6f363898a5392d84709))



## [2.1.1](https://github.com/gmtech-xyz/safe-cex/compare/v2.1.0...v2.1.1) (2023-03-31)


### Features

* **woo:** add latency mesure ([1aa9f3a](https://github.com/gmtech-xyz/safe-cex/commit/1aa9f3a20b9d0097a0bcadd2aad24b15cd81c628))



# [2.1.0](https://github.com/gmtech-xyz/safe-cex/compare/v2.0.0...v2.1.0) (2023-03-31)


### Bug Fixes

* **binance:** missing closing ws ([b72a62b](https://github.com/gmtech-xyz/safe-cex/commit/b72a62b4781da73a1c250be644ba8f332db42eae))
* **woo:** api v1 usage ([81d7eeb](https://github.com/gmtech-xyz/safe-cex/commit/81d7eeba3d81e0ada5562d1aea3f23296eb74821))
* **woo:** cancel order, catch err if already removed ([4429f77](https://github.com/gmtech-xyz/safe-cex/commit/4429f77220f01b12ff8f8783f13a65d84bd16741))
* **woo:** inverse volume & quoteVolume keys ([0d58047](https://github.com/gmtech-xyz/safe-cex/commit/0d58047fb67bb86ed4e4c743ba8ccc8cdf6ab145))
* **woo:** positional sl/tp better handling ([9fec937](https://github.com/gmtech-xyz/safe-cex/commit/9fec937090b8c7e5c8a9a0a7597e0258d9ac99e4))
* **woo:** support fill event on algo orders ([0df8856](https://github.com/gmtech-xyz/safe-cex/commit/0df8856914d1fdaa8f550d64db0d2d2a88f168a6))


### Features

* **exchanges:** bootstrap woo ([5b0735f](https://github.com/gmtech-xyz/safe-cex/commit/5b0735f408fe21bc7ca642faa838b68178868840))
* **woo:** add cancel orders ([fde1f99](https://github.com/gmtech-xyz/safe-cex/commit/fde1f99af8f525649f421790142e7d0e438ed155))
* **woo:** add cancel orders methods ([aac0480](https://github.com/gmtech-xyz/safe-cex/commit/aac0480fbac84ff6ef1a0fe3e1648091c00fa4a0))
* **woo:** add fetchOHLCV ([30977bf](https://github.com/gmtech-xyz/safe-cex/commit/30977bf58c4055404b91020bdeaa7c4a64e8e2da))
* **woo:** add listen ohlcv ([f8bab14](https://github.com/gmtech-xyz/safe-cex/commit/f8bab14a58ed16ed08f1491fb8898d422720e060))
* **woo:** add update leverage ([4ff6571](https://github.com/gmtech-xyz/safe-cex/commit/4ff6571ac116027f6b17f9c9d66a3be7fed41790))
* **woo:** bootstrap `placeOrder` ([ee42293](https://github.com/gmtech-xyz/safe-cex/commit/ee42293441af377dde76dc46f6b6b72eb5d8e429))
* **woo:** fetch orders ([e817dc2](https://github.com/gmtech-xyz/safe-cex/commit/e817dc2bde9c8008230d84213688af69221b8586))
* **woo:** handle `executionreport` events ([2818258](https://github.com/gmtech-xyz/safe-cex/commit/28182587e7d5422e0ef60b464c6d582d3a969cea))
* **woo:** include broker_id ([7e8c1bb](https://github.com/gmtech-xyz/safe-cex/commit/7e8c1bb97c3a397c03dda5f513fae8778467635b))
* **woo:** normalize symbol ([5cdcf39](https://github.com/gmtech-xyz/safe-cex/commit/5cdcf39ab1ec4105ca0f8053077b9c06efbccf96))
* **woo:** place position SL/TP on create ([157d010](https://github.com/gmtech-xyz/safe-cex/commit/157d010b35decf648f2a2e9567238e4e7b26c8db))
* **woo:** support trailing stops ([574d500](https://github.com/gmtech-xyz/safe-cex/commit/574d500b1d5eafd82e3e8c34a97019db539e9432))
* **woo:** support update of tsl updates ([d081c0e](https://github.com/gmtech-xyz/safe-cex/commit/d081c0e1963a860e90757a39009e180a662ab73e))
* **woo:** update algo orders & listen private updates ([2a018ec](https://github.com/gmtech-xyz/safe-cex/commit/2a018ec97ea48f5273f7598e63df98ee90e877ec))
* **ws:** connect after markets and tickers ([4aae18c](https://github.com/gmtech-xyz/safe-cex/commit/4aae18c6b71e2108e33bff7221464f6307b0e436))
* **ws:** improve memory ([fe0928e](https://github.com/gmtech-xyz/safe-cex/commit/fe0928ebf65e0eb84221e411133352dee9e007af))
* **ws:** log when disconnected ([ad59129](https://github.com/gmtech-xyz/safe-cex/commit/ad5912998d8a07d5dedd74ef36f4ad61afd101bb))



# [2.0.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.5...v2.0.0) (2023-03-27)


### Features

* **hedge-mode:** dont set hedge mode automatically ([b404bf1](https://github.com/gmtech-xyz/safe-cex/commit/b404bf1467600c6eb1e1080b2bd214a353e329b9))



## [1.6.5](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.4...v1.6.5) (2023-03-24)


### Bug Fixes

* **exchanges:** report latency with ping ([c7d7809](https://github.com/gmtech-xyz/safe-cex/commit/c7d7809537a183982591853292ab59a14538442a))



## [1.6.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.3...v1.6.4) (2023-03-24)


### Bug Fixes

* **bybit:** ask/bid keys in ws ([7c337eb](https://github.com/gmtech-xyz/safe-cex/commit/7c337eb68cf97cdab0607c48a54ddfd00d29f5c6))



## [1.6.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.6.0...v1.6.3) (2023-03-24)


### Bug Fixes

* **bybit:** tickers ask price ([6da00b8](https://github.com/gmtech-xyz/safe-cex/commit/6da00b8b9cb59350bb249c8169e10049bc46dff9))
* **bybit:** use `X-Referer` ([a53f92d](https://github.com/gmtech-xyz/safe-cex/commit/a53f92d76de998d52a11e67280b672678b83426d))


### Features

* **bybit:** add broker id ([f0eaf2f](https://github.com/gmtech-xyz/safe-cex/commit/f0eaf2fcce4192fd1252c99134c6626e738fa42f))



# [1.6.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.5.0...v1.6.0) (2023-03-21)


### Features

* **bybit:** use websocket from tickers data ([51181eb](https://github.com/gmtech-xyz/safe-cex/commit/51181eba2021f5bc37c6c83474b6c4634c626b6a))



# [1.5.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.4.0...v1.5.0) (2023-03-21)


### Features

* **binance:** use websocket for tickers data poll ([497dc2f](https://github.com/gmtech-xyz/safe-cex/commit/497dc2f296f94003ea2c9d119de0d467cdde529e))



# [1.4.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.5...v1.4.0) (2023-03-17)


### Features

* **binance:** support trailing stops ([0434664](https://github.com/gmtech-xyz/safe-cex/commit/04346642d3a1a466f03ba785ba221caae5e93204))
* **bybit:** place trailing stop loss ([3f4aafb](https://github.com/gmtech-xyz/safe-cex/commit/3f4aafba15b17f1a8a1d65198369e0e7d2469579))



## [1.3.5](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.4...v1.3.5) (2023-03-17)


### Bug Fixes

* **exchanges:** tick when page in background ([900fbde](https://github.com/gmtech-xyz/safe-cex/commit/900fbde441b9a3bfe10f7043bed8b0f496c62f4a))



## [1.3.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.3...v1.3.4) (2023-03-15)


### Features

* **validateAccount:** return exchange error ([9b4b6cf](https://github.com/gmtech-xyz/safe-cex/commit/9b4b6cfb6a432860de9de778ab511653b7f83a14))



## [1.3.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.2...v1.3.3) (2023-03-14)


### Features

* **binance:** use `positionRisk` endpoint for liq price ([38d1947](https://github.com/gmtech-xyz/safe-cex/commit/38d19473937ea6779f6fa189301d1534fb0135b0))



## [1.3.2](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.1...v1.3.2) (2023-03-14)


### Bug Fixes

* **binance:** filter out positions not matching a market ([0dedf25](https://github.com/gmtech-xyz/safe-cex/commit/0dedf2576deba272ea7118187c0ed431b484be6e))



## [1.3.1](https://github.com/gmtech-xyz/safe-cex/compare/v1.3.0...v1.3.1) (2023-03-06)


### Bug Fixes

* **order:** store and set `reduceOnly` on update ([aa8f353](https://github.com/gmtech-xyz/safe-cex/commit/aa8f35369351e38b14baee5a5443189a89f49729))



# [1.3.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.5...v1.3.0) (2023-03-06)


### Bug Fixes

* **bybit.updateOrder:** return correct orderIds ([53a1fee](https://github.com/gmtech-xyz/safe-cex/commit/53a1feed2982ed9882e01587115c3596ed6de1f2))


### Features

* **placeOrder:** accept `timeInForce` option ([38a3f06](https://github.com/gmtech-xyz/safe-cex/commit/38a3f062b459509982215e3f12ab3c4e4376e0f5))
* **placeOrder:** returns array of orderIds ([7c200dc](https://github.com/gmtech-xyz/safe-cex/commit/7c200dc0b465e8a71c89bed9bafaf8c304efb1ed))
* **updateOrder:** return string[] of orderIds ([a2c64d6](https://github.com/gmtech-xyz/safe-cex/commit/a2c64d6e190704f632656e8b715a037a4009c31f))



## [1.2.5](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.4...v1.2.5) (2023-03-03)


### Bug Fixes

* **binance:** batch delete orders ([95587fd](https://github.com/gmtech-xyz/safe-cex/commit/95587fd0ca5fb6957dfa2fe2c992877ede946676))


### Features

* **binance:** emit error from cancel orders ([a85d8aa](https://github.com/gmtech-xyz/safe-cex/commit/a85d8aa297bd78113deabcea362e5a0c516988b3))



## [1.2.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.3...v1.2.4) (2023-03-03)


### Bug Fixes

* **bybit:** dont duplicate SL/TP on split orders ([beaa657](https://github.com/gmtech-xyz/safe-cex/commit/beaa65749ea2228ba61fdb674228deb634acee18))



## [1.2.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.2...v1.2.3) (2023-03-02)


### Features

* **exchange:** emit error on `validateAccount` ([86618ec](https://github.com/gmtech-xyz/safe-cex/commit/86618ec38ce42b5e73b8a64394569e9af3580f53))



## [1.2.2](https://github.com/gmtech-xyz/safe-cex/compare/v1.2.0...v1.2.2) (2023-03-02)


### Bug Fixes

* **virtual-clock:** call `https` api ([c955cf1](https://github.com/gmtech-xyz/safe-cex/commit/c955cf1a5772124f1dc7719f3b8a7e4c45762cea))
* **virtual-clock:** start when create exchange, fallback APIs ([ad4b287](https://github.com/gmtech-xyz/safe-cex/commit/ad4b2872468ea6c8ecadf9c843c9c6016dd0aff1))



# [1.2.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.1.1...v1.2.0) (2023-02-28)


### Features

* **exchanges.api:** use server time for creating requests ([7c5ebdd](https://github.com/gmtech-xyz/safe-cex/commit/7c5ebddfd4a4b4442956e6b58845e1627ddf194d))
* **virtualclock:** use virtual clock with server time ([6cc98b5](https://github.com/gmtech-xyz/safe-cex/commit/6cc98b526630d0d3af9b66a8021a215531b13adb))



## [1.1.1](https://github.com/gmtech-xyz/safe-cex/compare/v1.1.0...v1.1.1) (2023-02-27)


### Bug Fixes

* **bybit:** condition for creating hedged tickers map ([495e126](https://github.com/gmtech-xyz/safe-cex/commit/495e12626ba5cfd513add27c4aebdcb0635e29e3))



# [1.1.0](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.4...v1.1.0) (2023-02-27)


### Features

* **binance:** support non-hedged mode ([82a1265](https://github.com/gmtech-xyz/safe-cex/commit/82a1265a1595a8f272af5860f2ebb51011b14ad8))
* **bybit:** support non-hedge mode ([ffe190b](https://github.com/gmtech-xyz/safe-cex/commit/ffe190b6779f69df55b897be3a25f0bcef0021c5))



## [1.0.4](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.3...v1.0.4) (2023-02-22)


### Features

* **log:** emit log messages ([6dd5f89](https://github.com/gmtech-xyz/safe-cex/commit/6dd5f8928d9865328fbb9d5a2cb2522847007271))



## [1.0.3](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.2...v1.0.3) (2023-02-21)


### Bug Fixes

* **bybit:** doesnt need CORS-Anywhere anymore ([fad87a9](https://github.com/gmtech-xyz/safe-cex/commit/fad87a9c742b3a30acaae7036ab042e022c88393))



## [1.0.2](https://github.com/gmtech-xyz/safe-cex/compare/v1.0.1...v1.0.2) (2023-02-21)



## [1.0.1](https://github.com/gmtech-xyz/safe-cex/compare/05c24aeb35ee0e678f906d5b9637e4512b31ad30...v1.0.1) (2023-02-21)


### Features

* **safe-cex:** update code from tuleep ([05c24ae](https://github.com/gmtech-xyz/safe-cex/commit/05c24aeb35ee0e678f906d5b9637e4512b31ad30))



