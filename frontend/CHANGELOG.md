# Changelog

## [0.7.0](https://github.com/mercadona/control-tower/compare/frontend-v0.6.0...frontend-v0.7.0) (2026-09-25)


### Funcionalidades

* a live coordinating session takes the whole page, showing only its current step ([#570](https://github.com/mercadona/control-tower/issues/570)) ([bed2385](https://github.com/mercadona/control-tower/commit/bed238598d772f1a2c2b13f12832cb8d1a9bb12f))
* read the repository from the checkout and drop the loose start-plan entrance ([#563](https://github.com/mercadona/control-tower/issues/563)) ([3e12075](https://github.com/mercadona/control-tower/commit/3e120759c675331eac536b099cdef638ee63e60a))
* tell a finished slice apart from a lost one ([#562](https://github.com/mercadona/control-tower/issues/562)) ([e31f370](https://github.com/mercadona/control-tower/commit/e31f37064bc487f8cfecaab1749496872bd0d0e7))
* the execution spec's path is derived from the conversation's story ([#568](https://github.com/mercadona/control-tower/issues/568)) ([48737cd](https://github.com/mercadona/control-tower/commit/48737cdd7a14f1cd35934c603be16917f95501b9))


### Correcciones

* preserve work progress during tracking failures ([#547](https://github.com/mercadona/control-tower/issues/547)) ([aafee10](https://github.com/mercadona/control-tower/commit/aafee1064e1edac7dcab2ae0861bb441033ad2f3))
* review the slicing without executing the groom, paste it whole, and hold the groom mid-turn ([#567](https://github.com/mercadona/control-tower/issues/567)) ([c32deb7](https://github.com/mercadona/control-tower/commit/c32deb744e62b944ca16e483b5c4009358aee1a8))

## [0.6.0](https://github.com/mercadona/control-tower/compare/frontend-v0.5.0...frontend-v0.6.0) (2026-09-24)


### Funcionalidades

* check Compose isolation before authorizing and dispatching slices ([#542](https://github.com/mercadona/control-tower/issues/542)) ([65718f0](https://github.com/mercadona/control-tower/commit/65718f035ff8c9bd424c272c0ec4c07927b83f72))
* unify work progress and separate recovery from reads ([#543](https://github.com/mercadona/control-tower/issues/543)) ([8798839](https://github.com/mercadona/control-tower/commit/8798839af8a3a16a8de596527cc1e2ae1dcb41d5))


### Correcciones

* **frontend:** fold planning into implementation and retire plan review ([#537](https://github.com/mercadona/control-tower/issues/537)) ([ac60e69](https://github.com/mercadona/control-tower/commit/ac60e69e1d24f317a806ea861630a5743a7719ac))

## [0.5.0](https://github.com/mercadona/control-tower/compare/frontend-v0.4.0...frontend-v0.5.0) (2026-09-23)


### Funcionalidades

* a person can get a run out of the judge's third veto ([#517](https://github.com/mercadona/control-tower/issues/517)) ([22559db](https://github.com/mercadona/control-tower/commit/22559dbbea0a41e1dbd18130dd8f083766cf84aa))
* **frontend:** follow the next running slice after delivery ([#516](https://github.com/mercadona/control-tower/issues/516)) ([cdd649d](https://github.com/mercadona/control-tower/commit/cdd649dfbfbc05b0bab86bcf7805992b2138e2c6))
* **frontend:** the slice panel shows the plan agent working ([#512](https://github.com/mercadona/control-tower/issues/512)) ([a2f71c2](https://github.com/mercadona/control-tower/commit/a2f71c2b3a352acee748f2af6a1cbc884b06db87))


### Correcciones

* **backend:** publish completed driver runs with recoverable delivery ([#506](https://github.com/mercadona/control-tower/issues/506)) ([c3fd7b3](https://github.com/mercadona/control-tower/commit/c3fd7b3672eb342ae78861e41bb616ed3f8c2c91))
* **frontend:** follow the next running slice when the selected slice enters review ([#525](https://github.com/mercadona/control-tower/issues/525)) ([58f4a11](https://github.com/mercadona/control-tower/commit/58f4a11ada4ab67b9b630d84f5ba2ea86217edf4))
* **frontend:** select the slice shown in the implementation detail ([#513](https://github.com/mercadona/control-tower/issues/513)) ([13dcb0d](https://github.com/mercadona/control-tower/commit/13dcb0dd71fb8d29459d2f2ef5a144c910bb547e))
* remove the planning comment and require a ticket ([#531](https://github.com/mercadona/control-tower/issues/531)) ([9cfc2ba](https://github.com/mercadona/control-tower/commit/9cfc2ba3a58b708727c7849089acb1488502d09d))
* the freeze asks for the Alcance line the scope gate reads, and the template writes it ([#508](https://github.com/mercadona/control-tower/issues/508)) ([1b5c17f](https://github.com/mercadona/control-tower/commit/1b5c17f0bd1463c08809ecf63a283efabda47640))

## [0.4.0](https://github.com/mercadona/control-tower/compare/frontend-v0.3.0...frontend-v0.4.0) (2026-09-21)


### Funcionalidades

* **frontend:** the session terminal fills the drawer ([#495](https://github.com/mercadona/control-tower/issues/495)) ([a2a08f2](https://github.com/mercadona/control-tower/commit/a2a08f280ffe3c708a5772ff983b55f84ba1fa54))


### Correcciones

* **backend:** the chain starts itself, because a coordinating session registers its checkout ([#492](https://github.com/mercadona/control-tower/issues/492)) ([35303a1](https://github.com/mercadona/control-tower/commit/35303a16f2cae9b2c88efce37fe568975b8661df))

## [0.3.0](https://github.com/mercadona/control-tower/compare/frontend-v0.2.0...frontend-v0.3.0) (2026-09-20)


### Funcionalidades

* **frontend:** an uncertain slice carries its recovery inside its own panel ([#466](https://github.com/mercadona/control-tower/issues/466)) ([e8d168a](https://github.com/mercadona/control-tower/commit/e8d168a2c87e8274924d2003b68a71ea7fcce602))
* **frontend:** the slice panel stops offering a message box ([#464](https://github.com/mercadona/control-tower/issues/464)) ([dfb1027](https://github.com/mercadona/control-tower/commit/dfb1027279f414025fc8fd9a2abd10b64af09693))


### Correcciones

* the yardstick reads the name of a parameterised test, so Spanish no longer escapes a describe.each ([#438](https://github.com/mercadona/control-tower/issues/438)) ([c1878ef](https://github.com/mercadona/control-tower/commit/c1878efc161bc4c1831cdc851cf9093ea007c120))

## [0.2.0](https://github.com/mercadona/control-tower/compare/frontend-v0.1.1...frontend-v0.2.0) (2026-09-17)


### Funcionalidades

* **frontend:** clarify planning flow and improve desktop usability ([#166](https://github.com/mercadona/control-tower/issues/166)) ([0604d14](https://github.com/mercadona/control-tower/commit/0604d146c90506d940027215c4bbfbc75204c6c9))
* **frontend:** el formulario manda user_comment (la [#121](https://github.com/mercadona/control-tower/issues/121), traída a main) ([ba537ae](https://github.com/mercadona/control-tower/commit/ba537aee817065958c5061bb73d477b149a57425))
* **frontend:** el formulario manda user_comment, el ticket deja de ser obligatorio y el id que vuelve null ya no rompe la UI ([01af1a1](https://github.com/mercadona/control-tower/commit/01af1a1f5e9ca82d707d6b1526f600f7deddc32d))
* **frontend:** el paso Implementación enseña el progreso real de la implementación ([592b58f](https://github.com/mercadona/control-tower/commit/592b58f84d771af9b6345d9204c96b942606d9fa))
* **frontend:** el paso Implementación enseña el progreso real de la implementación ([b52f651](https://github.com/mercadona/control-tower/commit/b52f651a37926757a0a460696291cdbe33068a68))
* **frontend:** el plan de continuar una sesión cerrada, y su slice 0 — el front se queda con la raíz canónica ([6ae99a5](https://github.com/mercadona/control-tower/commit/6ae99a56212213f2ad7cab210753d9c541b01cc7))
* **frontend:** the implementation stage lists the finished steps from GET /implement-history ([#309](https://github.com/mercadona/control-tower/issues/309)) ([35e8fcb](https://github.com/mercadona/control-tower/commit/35e8fcba39f4b22d1491f12f82ddce73b05bc649))
* quien arranca un plan se entera de si el repositorio estaba verde ([#196](https://github.com/mercadona/control-tower/issues/196)) ([d2c5eb6](https://github.com/mercadona/control-tower/commit/d2c5eb6ab50f15bf8b369059e54745ee2860b5b1))
* show where the delivery of a plan stands and link its pull request ([1d548cd](https://github.com/mercadona/control-tower/commit/1d548cda8cba61a6d1536a5e11b9dbeb6737a450))
* type the workflow state values ([#244](https://github.com/mercadona/control-tower/issues/244)) ([f55be29](https://github.com/mercadona/control-tower/commit/f55be29cbc6eae165dd107977b070318716708de))


### Correcciones

* **backend:** the usage line names the command the documentation starts the backend with ([#295](https://github.com/mercadona/control-tower/issues/295)) ([cbf78c6](https://github.com/mercadona/control-tower/commit/cbf78c66bac9ed1ac8123627142651d3996ada82))
* complete the implementation step on backend acceptance, not on pull request ([061f9c7](https://github.com/mercadona/control-tower/commit/061f9c75beeb9e589a444ad8ce49adec92b6e9eb))
* **frontend:** an unknown tool session reads as sin confirmar, not as a missing login ([#315](https://github.com/mercadona/control-tower/issues/315)) ([84a2ff1](https://github.com/mercadona/control-tower/commit/84a2ff172aacf02636ba2025eb335484376a8a7e))
* **frontend:** el banner de implementación deja de afirmar un paso ([213b818](https://github.com/mercadona/control-tower/commit/213b8183d32a8fdc903367f149d5ef5c8ddd30ef))
* **frontend:** el banner de implementación deja de afirmar un paso que ya dice el progreso ([7046338](https://github.com/mercadona/control-tower/commit/70463387b60438c766e714f0c8dde9047e69022b))
* **frontend:** el front guarda la raíz canónica que responde /start-plan ([03a031b](https://github.com/mercadona/control-tower/commit/03a031b4bc08af06a62f90bf239b001e7e5238a9))
* **frontend:** el progreso de la implementación enlaza su pull request ([c820936](https://github.com/mercadona/control-tower/commit/c82093646830ee48bc9647bef3aee580917a1257))
* **frontend:** el progreso de la implementación enlaza su pull request ([b3a7493](https://github.com/mercadona/control-tower/commit/b3a749372ce76ea33a6376800c17a3775da5a13e))
* **frontend:** el progreso de la implementación manda el repo que la [#126](https://github.com/mercadona/control-tower/issues/126) hizo obligatorio ([000a52d](https://github.com/mercadona/control-tower/commit/000a52d4cfee8244318e7ceaca9511740d7c4d99))
* **frontend:** el progreso de la implementación manda el repo y conoce los pasos de la revisión ([17e2c35](https://github.com/mercadona/control-tower/commit/17e2c356f7a1a87d7d3f06e07ef5445da0385254))
* **frontend:** the collapsed navbar shows one thing, the logo, until the toggle is asked for ([#313](https://github.com/mercadona/control-tower/issues/313)) ([f839a6d](https://github.com/mercadona/control-tower/commit/f839a6da05329da4a6223fd0628675c484350208))
* **frontend:** the right panel appears only while an implementation is running ([#320](https://github.com/mercadona/control-tower/issues/320)) ([#322](https://github.com/mercadona/control-tower/issues/322)) ([e04e484](https://github.com/mercadona/control-tower/commit/e04e48402f1db4780e55aa6e07695b5792b59b3f))
* **frontend:** the stage card keeps its own height instead of shrinking below its content ([#323](https://github.com/mercadona/control-tower/issues/323)) ([#324](https://github.com/mercadona/control-tower/issues/324)) ([8a97c98](https://github.com/mercadona/control-tower/commit/8a97c98713f1a1ba0706ace76823ce47e5be1683))
* la deuda del progreso de la implementación y los huecos del juez adversarial ([b72d843](https://github.com/mercadona/control-tower/commit/b72d84376c54df1dd370050fb700090cf23bd5ed))
* las cinco negativas que respondían 409 son juicios de la aplicación, y contestan 400 ([#180](https://github.com/mercadona/control-tower/issues/180)) ([fc9ce59](https://github.com/mercadona/control-tower/commit/fc9ce591f7636cd1281587a8d5b24d8510736b53))
* por qué no se pudo preguntar a cmux deja de perderse, y /external-tools lo pregunta antes ([#170](https://github.com/mercadona/control-tower/issues/170)) ([a114de4](https://github.com/mercadona/control-tower/commit/a114de4164877e9519051c398e83597467c10ed1))
* the pull request a review step waits on reaches the person who opens it ([750841c](https://github.com/mercadona/control-tower/commit/750841cb087d58421b14bdf7066deb2442f06adc))
* wait for the render implementation start triggers instead of looking once ([f726a68](https://github.com/mercadona/control-tower/commit/f726a68c22d28fa61b2f373addda1b20dc0fad77))

## [0.1.1](https://github.com/josemerca/control-tower-plugin/compare/frontend-v0.1.0...frontend-v0.1.1) (2026-09-07)


### Correcciones

* **frontend:** el localStorage de jsdom vuelve a los globals del test ([fcc11f6](https://github.com/josemerca/control-tower-plugin/commit/fcc11f637b2ee3fe245a98f56737b1c9bd4b0a66))
* **frontend:** el localStorage de jsdom vuelve a los globals del test ([35cceea](https://github.com/josemerca/control-tower-plugin/commit/35cceea711e42ba986abe2767fcf98643a3b4849))
* restore active workflows after restart ([6bc31b3](https://github.com/josemerca/control-tower-plugin/commit/6bc31b303b08a9917912bee0470a31d6eb7be83f))
