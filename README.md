# Share Local

Aplicativo Windows para duas pessoas compartilharem tela, áudio, conversa e arquivos na rede de casa. Sem cadastro ou senha: uma pessoa abre a sala, a outra pede para entrar e quem abriu autoriza. Ambos podem transmitir. Tela e áudio usam WebRTC, diretamente entre os computadores. Zahir (o rajadinho), Emma (a tricolor) e Priya (a panterinha) são os mascotes do tema.

**Novidades da 0.4.0:** perfil com nome e avatar, convites clicáveis, áudio opcional, troca de tela, janela flutuante, conversa e transferência de arquivos. Todas as melhorias escolhidas para as antigas etapas 0.5.0 e 0.6.0 foram reunidas nesta versão; veja [ROADMAP.md](ROADMAP.md).

**Novidades da 0.5.0:** painel lateral ao minimizar, transparência configurável, preferências salvas, modos de qualidade, recuperação de conexão, notificações silenciosas, fila de arquivos, pausa de imagem e áudio, atalhos e conversa e arquivos criptografados. Inclui editor de perfil com foto própria, recorte com zoom e posição, My Melody e Poporing. Os três gatos têm traços e descrições padronizados: Zahir, o rajadinho; Emma, a tricolor; Priya, a panterinha. Baixe `Share-Local-Instalar-0.5.0.exe` nas [Releases](https://github.com/GalbierY/share-local/releases/latest); o instalador local fica em `release/`.

No editor, use **Escolher imagem** para carregar PNG, JPG, WebP ou GIF de até 10 MB e 8192 pixels por lado. Ajuste o enquadramento e clique em **Salvar meu perfil**; **Cancelar** preserva o perfil anterior. A imagem é convertida em uma foto estática de 128 × 128 pixels, sem os metadados do arquivo original. **Remover foto** permite voltar a um dos cinco personagens. A foto aparece nos pedidos de entrada e na sala, inclusive quando o perfil é editado durante a conexão. Ao conectar com uma versão antiga, o nome continua aparecendo e fotos ou personagens novos são substituídos por Zahir nessa conexão.

## Usar

1. Baixe o instalador mais recente em [Releases](https://github.com/GalbierY/share-local/releases/latest) e instale nos dois computadores. Os builds locais ficam em `release/`.
2. Conectem os dois à mesma rede Wi-Fi ou cabo. No Firewall do Windows, permitam o Share Local em **redes privadas**. Não é necessário abrir portas no roteador.
3. Na primeira abertura, escolha seu nome e um dos cinco avatares ou uma foto própria. O perfil fica salvo neste computador e pode ser editado pela barra lateral, inclusive durante a sala.
4. Um abre a sala e usa **Copiar convite** para enviar um link. Com a 0.4.0 instalada, o link abre o Share Local com a sala preenchida. Também é possível colar o convite no aplicativo, selecionar uma sala encontrada ou informar o IP. Clique em **Pedir para entrar**; o link nunca envia o pedido automaticamente.
5. Quem abriu vê o nome, avatar e IP de quem pediu e escolhe **Autorizar entrada** ou **Recusar**. O pedido expira em um minuto e pode ser cancelado por quem pediu. Só um pedido fica pendente por vez; ninguém pode transmitir antes de ser autorizado.
6. Clique em **Compartilhar tela**, escolha entre **Telas** e **Janelas**, marque ou desmarque **Compartilhar áudio do computador** e clique em uma prévia para iniciar. A sala identifica quem está transmitindo. Use **Trocar tela** para mudar de monitor ou janela mantendo a conexão; se a nova captura falhar, a anterior continua. O botão **Parar transmissão** encerra a captura imediatamente; fechar o aplicativo também encerra.
7. Use **Painel lateral** ou minimize durante a conexão para acompanhar a sala sobre outros aplicativos. O painel mantém participantes, volume, conversa, arquivos e controles de transmissão. **Voltar à sala** restaura o tamanho anterior, e **Ocultar painel** permite usar a barra de tarefas. Fechar encerra o aplicativo e as capturas. Jogos em janela ou sem bordas funcionam melhor; tela cheia exclusiva pode ocultar o painel. Não há injeção no jogo.
8. Abra **Conversa** para trocar mensagens e links. Enter envia e Shift+Enter quebra a linha. Os links HTTP/HTTPS só abrem no navegador quando clicados; mensagens são texto, sem HTML. O histórico fica apenas nesta conexão, com até 100 mensagens visíveis.
9. Abra **Arquivos**, escolha vários arquivos ou arraste para a sala. A fila envia um por vez e pode ter até 100 arquivos. A outra pessoa usa **Aceitar e salvar** para escolher o destino de cada arquivo, ou **Recusar**. O envio mostra progresso e pode ser cancelado. Remover um pendente ou limpar a fila preserva o envio ativo; desconectar cancela toda a fila. Nenhum arquivo é aberto ou executado automaticamente.

Em **Preferências e atalhos**, configure notificações silenciosas, lado, transparência e comportamento ao minimizar. Volume, opção de áudio, qualidade e tamanho e posição da janela normal ficam salvos. Os modos são Automático (até 1080p/30 quadros por segundo), Econômico (até 720p/20) e Mais nítido (até 1440p/30); a taxa de envio se adapta à conexão dentro do limite escolhido. A resolução não é ampliada além da fonte.

**Pausar** desativa as faixas de imagem e áudio da sua transmissão; **Retomar** as reativa por uma ação sua. Durante a sala, Ctrl+Shift+M controla o áudio recebido, Ctrl+Shift+P pausa ou retoma, Ctrl+Shift+S para e Ctrl+Shift+O alterna o painel. Atalhos ocupados por outro aplicativo aparecem nas preferências. A janela usa uma barra de título própria com minimizar, maximizar e fechar.

Conversa e arquivos usam um canal WebRTC com DTLS, mesmo sem compartilhar tela. Compare o código de segurança exibido nas duas pontas por voz ou por um meio de confiança. Não há fallback para mensagens ou arquivos sem criptografia. Uma oscilação tenta recuperar a transmissão e o canal protegido por ICE. Se a sala cair, capturas e arquivos são encerrados, e o convite e as preferências ficam disponíveis para pedir entrada novamente; nada volta a transmitir automaticamente após uma nova entrada.

Arquivos existentes são preservados: escolha outro nome se já houver um arquivo no destino. O recebimento usa um arquivo parcial e confere tamanho e SHA-256 antes de concluir. Se o arquivo original mudar durante o envio, a transferência é interrompida. Cancelar, sair da sala ou fechar normalmente remove os parciais; um encerramento forçado pode deixar um arquivo `.share-local-*.part` na pasta escolhida.

Pedidos de entrada mostram uma contagem regressiva até expirar. Se este computador tiver mais de um IP privado, escolha no convite o IP da mesma rede da outra pessoa. Recarregar a interface encerra a sala e as capturas, preservando o perfil salvo.

Se a entrada falhar, o aplicativo mostra uma orientação e o botão **Tentar novamente**. Uma conexão sem resposta do anfitrião é encerrada em aproximadamente 25 segundos. A nova tentativa sempre envia um novo pedido e depende de autorização. Abrir um convite durante uma sala não encerra a conexão atual.

Os links `share-local://join?...` funcionam na mesma rede e exigem o aplicativo instalado. Alguns mensageiros não tornam protocolos próprios clicáveis; nesse caso, copie o link para o campo **Convite ou IP**. O instalador registra o protocolo no Windows; `npm start` permite testar colando o link no aplicativo, sem alterar as associações do Windows.

O perfil é guardado em `profile.json` e as preferências em `preferences.json`, na pasta de dados do aplicativo. Não há serviço de cadastro. A 0.5.0 continua conectando à 0.3.0 e à 0.4.0 para tela e áudio; conversa e arquivos ficam desativados nessas conexões. Fotos e personagens novos aparecem como Zahir nos aplicativos antigos. Atualize os dois computadores para a 0.5.0 para usar todas as funções.

A partir da 0.3.0, a entrada depende da autorização de quem abriu a sala. As releases até a 0.2.1 usam código de seis dígitos; atualize os dois computadores para a 0.3.0 antes de conectar.

Quando incluído, o áudio capturado é o de saída do computador inteiro, mesmo quando apenas uma janela é escolhida. Não há captura de microfone. O volume recebido pode ser ajustado sem alterar o volume do Windows. Enquanto você envia áudio, o som recebido fica pausado para evitar retorno; ao compartilhar só a imagem, você pode continuar ouvindo a outra pessoa. A opção de áudio também pode ser alterada ao usar **Trocar tela**. Algumas janelas protegidas, serviços de streaming e dispositivos de áudio podem impedir captura. Wi-Fi de convidados, isolamento entre dispositivos e VPN podem impedir conexão.

O instalador tem aproximadamente 97 MB porque inclui o Electron. Se esse tamanho ultrapassar o limite de anexos da sua conta do Discord, envie um link de download privado pelo Discord. Se houver apenas bloqueio da extensão `.exe`, um ZIP pode ser aceito, mas não reduz significativamente o tamanho. O instalador ainda não possui assinatura digital: o Windows pode exibir um aviso de editor desconhecido.

## Desenvolver

Node.js 22 ou superior, Windows x64:

```powershell
npm ci
npm start
npm test
npm run test:app
npm run dist
```

- `src/main.cjs`: janela Electron, captura, descoberta UDP e conexão da sala.
- `src/preload.cjs`: interface restrita entre a tela e o processo principal.
- `src/renderer.js`: interface e transmissão WebRTC.
- `src/room-tools.js`: conversa, transferências e modo flutuante na interface.
- `src/protocol.cjs`: validação das mensagens e dos endereços.
- `src/room-protocol.cjs`: validação de conversa, arquivos e links externos.
- `src/files.cjs`: envio em blocos, controle de fluxo, integridade e gravação de arquivos.
- `src/profile.cjs`: leitura e gravação do perfil local.
- `src/profile-editor.js`: prévia, escolha da foto e controles de recorte do perfil.
- `src/preferences.cjs` e `src/experience.js`: preferências, qualidade, pausa, atalhos e fila na interface.
- `src/secure-room.js` e `src/secure-bridge.cjs`: canal WebRTC com DTLS e ponte com controle de sessão e fluxo.
- `src/file-queue.cjs`: fila sequencial dos arquivos escolhidos pelo usuário.
- `src/invitations.cjs`: criação e validação dos convites.
- `scripts/installer.nsh`: registro do protocolo de convites no Windows e limpeza na desinstalação.
- `src/style.css`: aparência, sem biblioteca de interface.

As ações de arquivo e sistema são explícitas na ponte e validadas no processo principal. A interface não recebe acesso livre ao disco. A base mantém interface e acesso ao sistema separados, sem um sistema de plugins antecipado.

## Atualizações automáticas

A partir da versão 0.2.0, o aplicativo instalado verifica as releases públicas de `GalbierY/share-local` ao abrir e a cada quatro horas. Baixa em segundo plano, verifica a integridade pelo SHA-512 do manifesto e instala automaticamente quando não há uma sala aberta ou conexão em andamento. O app reinicia depois da instalação. Se estiverem em uma sala, a atualização espera vocês saírem; fechar o app também aplica uma atualização já baixada. Sem internet, o compartilhamento local continua funcionando e o atualizador tenta de novo depois.

**Migração da versão 0.1.0:** é necessário instalar manualmente a 0.2.0 uma única vez em cada PC, pois a primeira versão não continha atualizador. Depois disso, não é preciso reenviar instaladores pelo Discord.

Para lançar a próxima atualização, revise `RELEASE_NOTES.md`, faça commit das mudanças e execute na branch `main`:

```powershell
npm test
npm run test:app
npm version patch
git push --follow-tags origin main
```

`npm version patch` incrementa a versão, atualiza o lockfile e cria commit e tag (por exemplo, `v0.5.1`). Para mudanças maiores, use `npm version minor`. O workflow `.github/workflows/release.yml` roda no Windows, confere a versão da tag e o destino, executa os testes e publica o instalador, o `.blockmap` e `latest.yml` com as notas de `RELEASE_NOTES.md`. Não apague esses arquivos da release: o atualizador depende deles. A release precisa terminar de publicar para os aplicativos encontrarem a nova versão.

O token temporário usado na publicação vem do próprio GitHub Actions; nenhuma credencial é distribuída no instalador. O código e os binários são públicos. O tráfego de atualização usa HTTPS. O app mantém seu identificador interno original para preservar a identidade da instalação após a mudança de nome. O executável ainda não tem assinatura Authenticode; a confiança das atualizações depende do controle desta conta GitHub e do HTTPS. Proteja a conta com autenticação de dois fatores.

Para mudar o repositório de publicação **antes de distribuir**, rode `npm run updates:setup -- https://github.com/USUARIO/REPOSITORIO`, confira o destino e compile novamente. Trocar de endereço depois de distribuir exige uma última release no repositório anterior apontando para o novo. `npm run dist` gera os arquivos localmente sem publicá-los.

## Rede e limites

TCP 45878 para entrada, perfis e sinalização; UDP 45879 para descoberta; WebRTC negocia portas UDP dinâmicas para mídia e para o canal de conversa e arquivos. Só duas pessoas por sala. Conversa e arquivos funcionam mesmo sem compartilhar uma tela. Não funciona pela internet nesta versão. As salas anunciadas na rede expõem nome e IP. A entrada depende de autorização explícita de quem abriu a sala; pedidos recusados, cancelados ou expirados não dão acesso à transmissão.

A mídia e o canal de conversa e arquivos são criptografados pelo WebRTC. Perfis, pedidos de entrada e sinalização ainda trafegam no WebSocket local sem TLS: use uma rede doméstica de confiança e confira o IP com quem pediu para entrar. A autorização não prova sozinha a identidade da pessoa; compare o código do canal protegido por um meio de confiança. O SHA-256 dos arquivos também confere a integridade do conteúdo recebido. Não publique a porta no roteador. Uso fora de casa exige um projeto separado de sinalização autenticada e conectividade.

## Validação manual antes de distribuir

- Instalar a mesma versão nos dois PCs; criar uma sala, copiar o convite, encontrar e pedir para entrar.
- Escolher e editar o perfil; reiniciar o aplicativo e conferir que nome e avatar foram preservados.
- Carregar uma foto, ajustar zoom e posição, cancelar e salvar; testar My Melody e Poporing e conferir o perfil no outro PC atualizado e em um PC com a 0.4.0 publicada.
- Clicar em um convite com o aplicativo fechado, aberto e minimizado; confirmar a sala preenchida e que não houve entrada automática.
- Confirmar nome e avatar nos pedidos, nas pessoas da sala e durante a transmissão; editar o perfil e conferir a mudança no outro PC.
- Autorizar e recusar pedidos; confirmar que ninguém entra antes da autorização.
- Cancelar um pedido e deixar outro expirar após um minuto; confirmar que o aviso desaparece e um novo pedido pode ser feito.
- Tentar um pedido enquanto outro está pendente e um terceiro participante com a sala completa; ambos devem ser recusados.
- Transmitir tela com um vídeo e confirmar imagem e som no outro PC.
- Transmitir só imagem, ajustar o volume recebido e trocar de monitor ou janela sem sair da sala; incluir e remover o áudio durante as trocas.
- Fechar uma janela antes de selecioná-la e confirmar que a captura anterior continua; cancelar uma troca e confirmar que nenhum recurso fica capturando em segundo plano.
- Testar transmissão nos dois sentidos, inclusive simultânea; silenciar e tela cheia.
- Usar o modo flutuante, mover e redimensionar a janela, ajustar volume e retornar ao tamanho anterior.
- Minimizar conectado, configurar transparência e lado, ocultar e restaurar o painel e conferir os atalhos com o jogo em foco, em janela e sem bordas.
- Reiniciar e conferir volume, áudio, qualidade, notificações e janela; pausar e retomar e confirmar que imagem e som param no outro PC.
- Desligar notificações, receber mensagens e arquivos com outro aplicativo em foco e conferir os avisos silenciosos do Windows.
- Comparar o código protegido nos dois computadores, testar as três qualidades e oscilar a conexão sem retomar capturas após uma nova entrada.
- Arrastar vários arquivos, recusar um item, remover pendentes, limpar a fila durante um envio e desconectar durante a transferência.
- Conversar sem compartilhar tela; clicar em um link; confirmar que a conversa é apagada ao sair ou desconectar.
- Enviar arquivos nos dois sentidos; aceitar, recusar e cancelar; escolher pasta e nome; confirmar que um arquivo já existente fica intacto.
- Desconectar durante o envio e durante a escolha de destino; confirmar que uma conexão nova não recebe o arquivo antigo.
- Parar pela interface e pelo controle de captura do Windows; confirmar que a captura encerrou.
- Fechar o anfitrião; confirmar que o outro retorna à entrada. Reconectar.
- Testar o caminho por IP com a descoberta automática bloqueada.

Os testes unitários validam perfis, persistência, convites, protocolo e atualizador. `test:app` usa uma pasta temporária de perfil e abre o Electron sem janela visível. Testa perfis, convites, contagem regressiva, autorização, conexão, layout e compatibilidade. Os testes de mídia exercitam captura sem áudio, inclusão e remoção de áudio em uma conexão WebRTC real, troca de fonte, recuperação após falha parcial, volume, liberação das faixas e bloqueio de uma captura pendente quando a outra pessoa desconecta e entra novamente. Também verifica que recarregar cancela a sala e os pedidos pendentes. Salva as prévias `release/preview*.png`, incluindo `preview-profile.png` e `preview-sharing.png`. Os testes de entrada e perda de resposta exigem IP privado local; o script informa quando essa parte não é executada. O clique via associação do Windows, a fidelidade do áudio, firewall e qualidade entre dois computadores exigem validação manual. A atualização com instalação e reinício deve ser confirmada com duas releases em um PC de teste; os testes não reinstalam o aplicativo na máquina do desenvolvedor.

Os testes de arquivos cobrem envio real por WebSocket, arquivos vazios, recusa, cancelamento, checksum incorreto, alteração da origem, colisão de destino e descarte de ações de uma conexão antiga. `test:app` também verifica mensagens sem executar HTML, links bloqueados, pedido e recusa de arquivo e janela flutuante preservando o vídeo. As prévias adicionais são `preview-chat.png`, `preview-files.png` e `preview-floating.png`. Os seletores nativos de arquivo e destino exigem validação manual.

Na 0.5.0, `test:app` também abre canais WebRTC reais com DTLS nos dois sentidos, confere o código nas duas pontas, recusa conversa sem criptografia no WebSocket e transmite conteúdo de arquivo pela fila protegida a partir de arquivos nativos. Exercita ICE restart sem recriar a sala, candidatos ICE recebidos antes da oferta, pausa das duas faixas, cancelamento durante captura pendente, limite de qualidade, persistência das preferências, eventos de notificação e painel ao minimizar. As prévias `preview-overlay-secure.png` e `preview-settings.png` mostram o painel e as preferências. A transparência composta pelo Windows, o comportamento com cada jogo, as notificações nativas e a atualização instalada continuam exigindo teste manual.

`npm audit --omit=dev` não encontrou vulnerabilidades nas dependências distribuídas. A ferramenta de empacotamento possui um alerta moderado transitivo em `sprintf-js` (negação de serviço com precisão de formatação sem limite), ainda presente após `npm audit fix`; essa dependência não entra no aplicativo distribuído.
