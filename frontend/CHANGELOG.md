# Changelog

## [0.2.0](https://github.com/mercadona/control-tower/compare/frontend-v0.1.1...frontend-v0.2.0) (2026-09-12)


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
