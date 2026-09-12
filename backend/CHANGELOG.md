# Changelog

## [0.3.0](https://github.com/mercadona/control-tower/compare/backend-v0.2.0...backend-v0.3.0) (2026-09-12)


### Funcionalidades

* ask an issue whether it stands exactly in review ([50a0ca0](https://github.com/mercadona/control-tower/commit/50a0ca003bb180685f3bcb8625c7b3ba4b29439e))
* **backend:** /external-tools stops guessing when it could not look ([#270](https://github.com/mercadona/control-tower/issues/270)) ([eb59ca7](https://github.com/mercadona/control-tower/commit/eb59ca7672ca932ee0df6f76a0bff3b0f5291424))
* **backend:** el comentario llega al issue en su propia sección, solo cuando lo hay (tarea 2/7, user_comment en /start-plan) ([18de709](https://github.com/mercadona/control-tower/commit/18de7096fda0500813f6b8634beb4bb3466d0278))
* **backend:** el encargo manda al agente leer lo que pidió a mano quien arrancó el plan (tarea 6/7, user_comment en /start-plan) ([057c400](https://github.com/mercadona/control-tower/commit/057c400f525fc720f52d5648b046bf52da069ab6))
* **backend:** el id de un plan sin historia es null, decidido una vez en PlanWatch.storyText() (tarea 4/7, user_comment en /start-plan) ([56a7de0](https://github.com/mercadona/control-tower/commit/56a7de0edb915d00a494769992f2af1030354c53))
* **backend:** el rechazo de repo/path nombra el campo desde la request, no desde la constante (tarea 2/4, repo_list en /start-plan) ([b86f7bd](https://github.com/mercadona/control-tower/commit/b86f7bde1fab6e5a6e2a5809d24910a410c93113))
* **backend:** GET /implement-history/:issue exposes the per-step metrics journal ([#306](https://github.com/mercadona/control-tower/issues/306)) ([d407694](https://github.com/mercadona/control-tower/commit/d407694eff75a238c931dfe38ebf31e27fe98cd4))
* **backend:** la pestaña cmux de un plan sin historia se llama por su issue, y la recuperación la lee de vuelta (tarea 5/7, user_comment en /start-plan) ([cfc4e2c](https://github.com/mercadona/control-tower/commit/cfc4e2c1adb6dd3a0ece75530966d2df8a6aea60))
* **backend:** la ruta de start-plan lee repo_list y arranca un plan por repo (tarea 3/4, repo_list en /start-plan) ([ea515bd](https://github.com/mercadona/control-tower/commit/ea515bd69505aa66940eac1e68bd97e750223482))
* **backend:** POST /start-plan acepta repo_list y arranca un plan por repo ([743cf16](https://github.com/mercadona/control-tower/commit/743cf165eb367b9f37bc53ff138f7857e3153b5d))
* **backend:** POST /start-plan acepta user_comment, id pasa a ser opcional y un cuerpo sin ninguno de los dos se rechaza por su nombre (tarea 7/7, user_comment en /start-plan) ([1371ab6](https://github.com/mercadona/control-tower/commit/1371ab62fd901a35fed820a98f4e2be63e75f88b))
* **backend:** POST /start-plan acepta user_comment, y sin historia de Jira abre el issue desde el comentario ([d89e415](https://github.com/mercadona/control-tower/commit/d89e4152a37d435bf19f545ae9aee2e5c94df1df))
* **backend:** retire the transitional JavaScript support ([#293](https://github.com/mercadona/control-tower/issues/293)) ([8a23a7a](https://github.com/mercadona/control-tower/commit/8a23a7afec4db399fac3861a5751ce60c1de5d93))
* **backend:** StartPlan planifica desde un comentario sin preguntar a Jira, y el comentario llega a open (tarea 1/7, user_comment en /start-plan) ([0078d8a](https://github.com/mercadona/control-tower/commit/0078d8aaeb12bad202f20a37eb794486b38ec1e7))
* **backend:** StartPlan planifica una lista de destinos, con el arranque de un repo intacto (tarea 1/4, repo_list en /start-plan) ([9234b92](https://github.com/mercadona/control-tower/commit/9234b921c5b4874785adc5a700da0a2924ea464b))
* **backend:** type ApiServer and the integrated HTTP tests ([#287](https://github.com/mercadona/control-tower/issues/287)) ([4bd4559](https://github.com/mercadona/control-tower/commit/4bd4559ebc2444d05d6d4e66867ee80c166e107f))
* **backend:** type the background conductors ([#279](https://github.com/mercadona/control-tower/issues/279)) ([6890ae2](https://github.com/mercadona/control-tower/commit/6890ae262af2c86e5f3eac4f1a0982b1defb1ed7))
* **backend:** type the entrypoint and run it as TypeScript ([#289](https://github.com/mercadona/control-tower/issues/289)) ([4626166](https://github.com/mercadona/control-tower/commit/46261662ac785255987ea973c858fd8df2190d3f))
* **backend:** type the implementation routes ([#283](https://github.com/mercadona/control-tower/issues/283)) ([ca7c404](https://github.com/mercadona/control-tower/commit/ca7c4041e9794c2996427c4deefc7ddd7b4655fb))
* **backend:** type the review-plan route ([#280](https://github.com/mercadona/control-tower/issues/280)) ([60cd4e8](https://github.com/mercadona/control-tower/commit/60cd4e851b90522f0c25e62e2a9e63a6cf4480e6))
* **backend:** type the session, active-plan and tool-survey routes ([#284](https://github.com/mercadona/control-tower/issues/284)) ([27070f9](https://github.com/mercadona/control-tower/commit/27070f957d4823bce622379f8c1043ab7a877f4e))
* **backend:** type the shared HTTP primitives and projection ([#276](https://github.com/mercadona/control-tower/issues/276)) ([606b83a](https://github.com/mercadona/control-tower/commit/606b83ae8c907dc8046e0b35ac0b17e34e1aa0f1))
* **backend:** type the start-plan route and request model ([#282](https://github.com/mercadona/control-tower/issues/282)) ([0f35f84](https://github.com/mercadona/control-tower/commit/0f35f84a19c712012f8f38f906aa2c7bd32bdf10))
* **backend:** un issue sin historia de usuario nace del comentario: título, primera línea y contexto (tarea 3/7, user_comment en /start-plan) ([a5608fc](https://github.com/mercadona/control-tower/commit/a5608fcad128e5803c87046dea24c3bbed64a51b))
* **conventions:** la vara de ct se hace agnóstica y hereda lo que el backend pagó ([1ec89b9](https://github.com/mercadona/control-tower/commit/1ec89b98a00e7109ef9b8752db5fcd779a7d577c))
* el segundo veto escala a un consejero en vez de repetir el intento a ciegas ([3252e3a](https://github.com/mercadona/control-tower/commit/3252e3a8c69a815388b943b72481f4f413088de5))
* establish the TypeScript runtime and type-check gate ([#238](https://github.com/mercadona/control-tower/issues/238)) ([9d5223f](https://github.com/mercadona/control-tower/commit/9d5223f9469a269fac8e71d899ae6a677cf52bc7))
* **frontend:** the implementation stage lists the finished steps from GET /implement-history ([#309](https://github.com/mercadona/control-tower/issues/309)) ([35e8fcb](https://github.com/mercadona/control-tower/commit/35e8fcba39f4b22d1491f12f82ddce73b05bc649))
* hand the watch over to the pull request when implementation starts ([c8737d5](https://github.com/mercadona/control-tower/commit/c8737d5fd1517fe920868653824fddfc146b008a))
* keep the stream alive through the delivery of a plan ([33131e6](https://github.com/mercadona/control-tower/commit/33131e69d251bbf6eaa17749fc6fdc983c55129b))
* la sesión que abre el backend nombra su modelo en vez de heredar el del usuario ([#153](https://github.com/mercadona/control-tower/issues/153)) ([15e2097](https://github.com/mercadona/control-tower/commit/15e20975f77b82d0e00b3430a388f5621f9a4ae7))
* pedir fixes en la pull request de un plan ([cf9919d](https://github.com/mercadona/control-tower/commit/cf9919d9569bfd3552073cf9ddc4d06836942a37))
* **plugin:** el paso advise, declarado en los dos lados del contrato ([0b8ce48](https://github.com/mercadona/control-tower/commit/0b8ce4874c4b461419fafaf2308326b7f7316c38))
* prevent new backend JavaScript during the migration ([#239](https://github.com/mercadona/control-tower/issues/239)) ([9153a27](https://github.com/mercadona/control-tower/commit/9153a27b98bdc160d718da2bb532fad093556565))
* prove the mixed graph with SownWorkspace ([#240](https://github.com/mercadona/control-tower/issues/240)) ([0e4488c](https://github.com/mercadona/control-tower/commit/0e4488c7914a7246d1507de8f342455037e9bb87))
* quien arranca un plan se entera de si el repositorio estaba verde ([#196](https://github.com/mercadona/control-tower/issues/196)) ([d2c5eb6](https://github.com/mercadona/control-tower/commit/d2c5eb6ab50f15bf8b369059e54745ee2860b5b1))
* read the fixes asked for only while the issue stands in review ([0a92591](https://github.com/mercadona/control-tower/commit/0a925911d763dc725ace1a89e227de3d10fd556e))
* read the reviews of a pull request as changes asked for ([7a4eebe](https://github.com/mercadona/control-tower/commit/7a4eebe302ac1653cbdc93dedec81c2f0ccae405))
* reopen the slice before typing the fixes into its agent ([033eafc](https://github.com/mercadona/control-tower/commit/033eafc26a1d4b3a518c40666b080da9f2930c3b))
* send a reviewed slice back to the workbench ([d27dd5d](https://github.com/mercadona/control-tower/commit/d27dd5d9389b7369d3aa485725fe127e44f78faa))
* the review of a pull request continues main's implementation progress ([37bddbb](https://github.com/mercadona/control-tower/commit/37bddbbd4197be955d6f5f797161615bc12d5f07))
* type the cmux plan agents and the briefing ([#269](https://github.com/mercadona/control-tower/issues/269)) ([c67c35e](https://github.com/mercadona/control-tower/commit/c67c35e8a96bac0cef04911a242485ebc9960c20))
* type the delivery actions ([#252](https://github.com/mercadona/control-tower/issues/252)) ([b5814d8](https://github.com/mercadona/control-tower/commit/b5814d8b7aff103d105cb2799a9884e3c7233a0e))
* type the disk registries ([#263](https://github.com/mercadona/control-tower/issues/263)) ([4007888](https://github.com/mercadona/control-tower/commit/40078880cd0208f003c563efbd0d2c49cab9cd89))
* type the dispatch and progress adapters ([#268](https://github.com/mercadona/control-tower/issues/268)) ([82ff09a](https://github.com/mercadona/control-tower/commit/82ff09a5619df8685261f4cdf20a491654365c18))
* type the domain exceptions and policies ([#245](https://github.com/mercadona/control-tower/issues/245)) ([f70ce2a](https://github.com/mercadona/control-tower/commit/f70ce2a4d973604197a40df79cd105f789e1b7c5))
* type the git workspace adapter ([#266](https://github.com/mercadona/control-tower/issues/266)) ([ab3726d](https://github.com/mercadona/control-tower/commit/ab3726d5c7f5911f139971b7ec50960aeaf67217))
* type the github plan-issue adapter ([#265](https://github.com/mercadona/control-tower/issues/265)) ([e91fc57](https://github.com/mercadona/control-tower/commit/e91fc57536463e56b087c0d1c7c17465f04d3d0b))
* type the GitHub pull-request adapter ([#260](https://github.com/mercadona/control-tower/issues/260)) ([6876ea0](https://github.com/mercadona/control-tower/commit/6876ea07ab6a5e8c53106dcb997d1733ba709f92))
* type the implementation-reading queries ([#254](https://github.com/mercadona/control-tower/issues/254)) ([5ad07e3](https://github.com/mercadona/control-tower/commit/5ad07e33c5402a3b10e024a369a84536b3c264d9))
* type the multi-repository start flow ([#251](https://github.com/mercadona/control-tower/issues/251)) ([fdff663](https://github.com/mercadona/control-tower/commit/fdff6631d5489e01243f2bf554cda93d8eaa99c6))
* type the plan identity and request values ([#243](https://github.com/mercadona/control-tower/issues/243)) ([d7f7445](https://github.com/mercadona/control-tower/commit/d7f7445682c1d4a4504e79cc8390dc484479ea30))
* type the plan lifecycle actions ([#249](https://github.com/mercadona/control-tower/issues/249)) ([a32e745](https://github.com/mercadona/control-tower/commit/a32e745f5ec57d53da2bdf22e391a4417b493bff))
* type the plan-reading queries ([#253](https://github.com/mercadona/control-tower/issues/253)) ([559bfe7](https://github.com/mercadona/control-tower/commit/559bfe7db0f1ddbee423996f3a9f258e42df38d6))
* type the planning ports ([#248](https://github.com/mercadona/control-tower/issues/248)) ([90bcd54](https://github.com/mercadona/control-tower/commit/90bcd54385ff94f9e5df4d3c9f83db0ecf38e2e5))
* type the process execution primitives ([#256](https://github.com/mercadona/control-tower/issues/256)) ([8b71c8e](https://github.com/mercadona/control-tower/commit/8b71c8ee768a3fb83cf3651fe572141493ad0fd4))
* type the progress and review ports ([#246](https://github.com/mercadona/control-tower/issues/246)) ([6f01caa](https://github.com/mercadona/control-tower/commit/6f01caabfb54f956bcd19e07b19862dfc08beaac))
* type the repository and workspace identifiers ([#241](https://github.com/mercadona/control-tower/issues/241)) ([41b7112](https://github.com/mercadona/control-tower/commit/41b71120eed30c96adacc44877b786360f2ddf33))
* type the survey queries ([#255](https://github.com/mercadona/control-tower/issues/255)) ([2d045bf](https://github.com/mercadona/control-tower/commit/2d045bf4cfb10dad209460f9a4f822629de54e1e))
* type the user story values and their reference ([#242](https://github.com/mercadona/control-tower/issues/242)) ([5648474](https://github.com/mercadona/control-tower/commit/5648474152107854c4bdb632e39e0dca1903d72b))
* type the user-story adapters ([#259](https://github.com/mercadona/control-tower/issues/259)) ([7f6e6a8](https://github.com/mercadona/control-tower/commit/7f6e6a8f010e6991507ce783902a7b1d726021e6))
* type the workflow state values ([#244](https://github.com/mercadona/control-tower/issues/244)) ([f55be29](https://github.com/mercadona/control-tower/commit/f55be29cbc6eae165dd107977b070318716708de))
* type worktree discovery and active-plan recovery ([#274](https://github.com/mercadona/control-tower/issues/274)) ([43c0c9e](https://github.com/mercadona/control-tower/commit/43c0c9e0e74c43f812f26f0c3976cf8a9c097830))
* wire the pull request review watch into the entrypoint ([34438fa](https://github.com/mercadona/control-tower/commit/34438fa551d653abface0e387d5ff65542e3b8b6))
* word the errand that asks the agent to fix its pull request ([ef3fb45](https://github.com/mercadona/control-tower/commit/ef3fb4535c117c67bc2805025d6969280c2c3acc))


### Correcciones

* a plan that was already implementing gets its pull request watched again ([891fbee](https://github.com/mercadona/control-tower/commit/891fbee68dec52400c17d304998c6b0e09c23b8c))
* a transient read failure during delivery no longer forgets the session ([f65f28d](https://github.com/mercadona/control-tower/commit/f65f28de37f0077a7a731491e9c0b05e75302c5d))
* **backend:** a comment with no author folds in unattributed instead of crashing ([#294](https://github.com/mercadona/control-tower/issues/294)) ([d6ea905](https://github.com/mercadona/control-tower/commit/d6ea90558102c1c820af188b50a94e952a516722))
* **backend:** la cosecha del review de la rama repo_list en /start-plan — registro invisible del listado, el 400 post-preflight que dependía de un throw imposible, y el resto del punch list (0-riesgo, 7/7) ([b53537d](https://github.com/mercadona/control-tower/commit/b53537d5baee345c4175558ac108b73c67bc8696))
* **backend:** las tres rutas GET rechazan igual un verbo que no sirven ([1d5e266](https://github.com/mercadona/control-tower/commit/1d5e266a527b813073f568251d19567448174146))
* **backend:** lo que el juez del slice señaló como minor — el prefijo issue- se deriva una vez, los tests fijan los literales, el puerto describe su firma y PlanComment pierde el toString sin llamador (user_comment en /start-plan) ([d0ca853](https://github.com/mercadona/control-tower/commit/d0ca853f78389ebf61e5627f50da544ef2b44d99))
* **backend:** no dar por arrancada una implementacion cuyo run file aun no existe ([a9a1f41](https://github.com/mercadona/control-tower/commit/a9a1f41d9c1627a7b8b72a3acbb89a8e0122dc84))
* **backend:** quita del documento propio las reglas generales que viajaron pegadas, y añade la comprobación inversa ([6e8360e](https://github.com/mercadona/control-tower/commit/6e8360e733d8b61d61d3e7e2e4b448c331d562ff))
* **backend:** recuperar como implementing un go sin marcador si el run file muestra trabajo en marcha ([eda24ae](https://github.com/mercadona/control-tower/commit/eda24ae92917f884bbe28fba22bbf80f8253cf36))
* **backend:** repone ocho reglas propias que el borrado dejó sin dueño y cierra el punto ciego del test de la vara ([ccb9d72](https://github.com/mercadona/control-tower/commit/ccb9d724ff52d792e7b424d1701c98657a8198ab))
* **backend:** the event stream declares its own error codes, and the guard stops remembering them by hand ([#303](https://github.com/mercadona/control-tower/issues/303)) ([4ceebe4](https://github.com/mercadona/control-tower/commit/4ceebe4c976ba6485b0ea48a71f9eaebd5315a29))
* **backend:** the usage line names the command the documentation starts the backend with ([#295](https://github.com/mercadona/control-tower/issues/295)) ([cbf78c6](https://github.com/mercadona/control-tower/commit/cbf78c66bac9ed1ac8123627142651d3996ada82))
* **backend:** un go anterior al registro de marcadores ya no bloquea la app para siempre ([a85373e](https://github.com/mercadona/control-tower/commit/a85373e1a8f10b5a1914666d4fa4eece25f7873d))
* **backend:** una lista donde arrancó ninguno responde 400 no-plan-started con failed, no un 202 vacío (tarea 4/4, repo_list en /start-plan) ([c253c92](https://github.com/mercadona/control-tower/commit/c253c9268905f41e447fe53d0f5704f3be9ba3ed))
* **convenciones:** donde corre la suite se queda con el comando, sin reescribir el cierre de la vara ([87e7525](https://github.com/mercadona/control-tower/commit/87e75253a719f6fbea691cc76dbbd3802633ab15))
* **convenciones:** el comando de la suite rapida vuelve a estar escrito, y la captura se declara ([8af7a75](https://github.com/mercadona/control-tower/commit/8af7a75275155000a022a05fbbd58f9f53088973))
* **conventions:** repone el layout propio, da regla a la forma servicio y corrige las cifras ([5f9080b](https://github.com/mercadona/control-tower/commit/5f9080be3ed9fe605c73441132aba84e2809401a))
* deliver at most one review change per tick ([25dddb7](https://github.com/mercadona/control-tower/commit/25dddb75cf4deff53095df4c251fc4c30a42af35))
* drop PlanSessions.forget with no caller left ([507dbf5](https://github.com/mercadona/control-tower/commit/507dbf5e4fff0f3dde33931d1606ec0c55379ba4))
* keep issueNumber a bare number through the pull request fix lane ([c1f1dc0](https://github.com/mercadona/control-tower/commit/c1f1dc0a5de3e83bbf0d42f93e0301ca262b7cca))
* la deuda del progreso de la implementación y los huecos del juez adversarial ([b72d843](https://github.com/mercadona/control-tower/commit/b72d84376c54df1dd370050fb700090cf23bd5ed))
* las cinco negativas que respondían 409 son juicios de la aplicación, y contestan 400 ([#180](https://github.com/mercadona/control-tower/issues/180)) ([fc9ce59](https://github.com/mercadona/control-tower/commit/fc9ce591f7636cd1281587a8d5b24d8510736b53))
* one Gh client shared, and isInReview names its own read failure ([3aa704a](https://github.com/mercadona/control-tower/commit/3aa704ae1befba401720b0123c4c42e1f4bdb255))
* paginate the pull request reviews and line comments gh reads ([9a9bc83](https://github.com/mercadona/control-tower/commit/9a9bc8372ed25a346062d550506d7f31b0562c17))
* pin gh api reads of a pull request to GET, never a write ([c4a6096](https://github.com/mercadona/control-tower/commit/c4a609645e6d35b453cf3172a8dd2ab93aabef6b))
* por qué no se pudo preguntar a cmux deja de perderse, y /external-tools lo pregunta antes ([#170](https://github.com/mercadona/control-tower/issues/170)) ([a114de4](https://github.com/mercadona/control-tower/commit/a114de4164877e9519051c398e83597467c10ed1))
* un cambio pedido al plan se marca atendido cuando llega al agente, no antes ([#195](https://github.com/mercadona/control-tower/issues/195)) ([d375634](https://github.com/mercadona/control-tower/commit/d37563421618b27eb393a95fed71222cfb5539ad))
* where a plan issue stands travels as the vocabulary it is, not as a boolean ([8a89864](https://github.com/mercadona/control-tower/commit/8a89864a378ea0a99fbeb7ea131051200c10678a))


### Refactorizaciones

* **backend:** lo que era general subió a la vara; aquí queda lo propio ([9abe889](https://github.com/mercadona/control-tower/commit/9abe88926db3c3cf4ad85881f548a9d645c463bc))
* make the review watch name what it watches ([05f8c64](https://github.com/mercadona/control-tower/commit/05f8c6470c7a4174d3f56a70c873c5c92209892c))
* move ChangeAsked to the domain for its second constructor ([b132507](https://github.com/mercadona/control-tower/commit/b132507517ab1e4d4f66b1f14ba6edc7575df5e2))
* PlanWatch drops the delivering flag the merge left behind ([2118853](https://github.com/mercadona/control-tower/commit/2118853ec4987491388bfbe60ed78c03b804d4c2))
* the loop's branch prefix comes from the plugin that owns it ([b03cfce](https://github.com/mercadona/control-tower/commit/b03cfceb25244dcbb3ca3f89bf44ad755115deea))
* the status vocabulary needs no method for its own contract test ([1d2f032](https://github.com/mercadona/control-tower/commit/1d2f03260f266112d5a08617538d7c5b4a305f8b))
* underReview stops repeating what TASKLESS already decided ([6c38097](https://github.com/mercadona/control-tower/commit/6c3809776480a0c83401842b7afb8ad8a3326369))


### Documentación

* a repository control is not an obstacle to route around ([#258](https://github.com/mercadona/control-tower/issues/258)) ([ce1f20f](https://github.com/mercadona/control-tower/commit/ce1f20ffcf2b3df5ae915b248a77d2f2849328ac))
* measure an adapter against a declared shape, not a captured one ([dcdde1e](https://github.com/mercadona/control-tower/commit/dcdde1e53b4b2e2404141c6f84bb8b807548a1c6))
* the words this loop added enter the ubiquitous language ([0afdfa9](https://github.com/mercadona/control-tower/commit/0afdfa93f16605534eeab26effc2d7da41c809f2))

## [0.2.0](https://github.com/josemerca/control-tower-plugin/compare/backend-v0.1.0...backend-v0.2.0) (2026-09-07)


### Funcionalidades

* **backend:** el encargo del agente de plan señala el baseline, ya no lo ordena ([43721fb](https://github.com/josemerca/control-tower-plugin/commit/43721fb1a924e3a1ddfa689664a2654f583eb73a))
* **backend:** GitWorkspace mide el baseline del worktree que prepara ([766f3f7](https://github.com/josemerca/control-tower-plugin/commit/766f3f770dc60638640f74d3a9fd19f42fa6d9c4))
* el baseline lo mide el programa, no lo afirma el agente ([1ad63b9](https://github.com/josemerca/control-tower-plugin/commit/1ad63b9edfb3c8099554be62899ff5462f25ecfa))
* la vara viaja por alcance, la precedencia se escribe una vez y el token lo pone el programa ([76a895f](https://github.com/josemerca/control-tower-plugin/commit/76a895fc0a1fd4039f66e36593dfd4613acb4982))


### Correcciones

* restore active workflows after restart ([6bc31b3](https://github.com/josemerca/control-tower-plugin/commit/6bc31b303b08a9917912bee0470a31d6eb7be83f))


### Refactorizaciones

* **backend:** errandFor importa la cabecera de la vara en vez de repetir la regla ([a2e8694](https://github.com/josemerca/control-tower-plugin/commit/a2e8694fb40469fd6dda22e7314f666aefdd9309))
