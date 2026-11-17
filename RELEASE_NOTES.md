# Share Local 0.4.0

## Novidades

- **Janela flutuante:** acompanhe o vídeo sobre outros aplicativos, com volume e silêncio. Voltar à sala restaura o tamanho anterior sem recriar a transmissão.
- **Conversa na sala:** mensagens e links com identificação pelo perfil, sem precisar compartilhar tela. O histórico fica apenas na conexão atual.
- **Arquivos entre vocês:** escolha um arquivo, aguarde o aceite e acompanhe o progresso. Quem recebe escolhe o destino e pode recusar ou cancelar. O aplicativo confere tamanho e SHA-256, preserva arquivos existentes e nunca abre ou executa o conteúdo recebido.
- **Seu perfil:** escolha um nome e um avatar de Zahir, Emma ou Priya. O perfil fica salvo neste computador, sem cadastro, e pode ser editado na barra lateral.
- Pedidos de entrada mostram nome, avatar e IP. A sala identifica quem está conectado e quem está compartilhando a tela. Edições do perfil aparecem para a outra pessoa durante a conexão.
- **Convites clicáveis:** Copiar convite gera um link que abre o Share Local e preenche a sala. Também é possível colar o link no campo Convite ou IP. A entrada continua dependendo de um pedido explícito e da autorização de quem abriu a sala.
- **Conexão mais clara:** orientações para falhas, sala ocupada, pedido recusado ou expirado, e botão Tentar novamente. Uma conexão sem resposta do anfitrião é encerrada em aproximadamente 25 segundos, permitindo um novo pedido.
- Um convite recebido durante uma sala não interrompe a conexão atual. Links com destinos fora da rede local ou parâmetros inválidos são recusados.
- **Áudio opcional e volume:** compartilhe só a imagem ou inclua o áudio do computador, e ajuste o volume recebido. Ao transmitir só imagem, o som da outra pessoa continua disponível.
- **Trocar tela:** mude de monitor ou janela sem sair da sala nem interromper a conexão. Se a nova captura falhar, a anterior é preservada. As faixas antigas são encerradas após uma troca concluída.
- Pedidos mostram quanto tempo falta para expirar. Computadores com mais de um IP privado permitem escolher o endereço do convite.
- Recarregar a interface encerra a sala e as capturas. Uma captura iniciada na conexão anterior nunca é retomada automaticamente para quem entrar depois.

## Atualização

Atualize os dois computadores para a 0.4.0 para usar todas as funções. A conexão com a 0.3.0 continua funcionando para tela e áudio; participantes sem perfil aparecem como Outra pessoa, e conversa e arquivos ficam desativados. Versões 0.2.x usam o protocolo antigo com código e precisam ser atualizadas.

Instale `Share-Local-Instalar-0.4.0.exe` para registrar os links `share-local://` no Windows. Alguns mensageiros não tornam esses links clicáveis; nesse caso, cole o convite no aplicativo. Os dois computadores precisam estar na mesma rede.

O aplicativo continua limitado a duas pessoas por sala. Quando incluído, o áudio é o do computador inteiro. O instalador ainda não tem assinatura digital.

Use somente em uma rede doméstica de confiança. A mídia WebRTC é criptografada; conversa e arquivos usam o canal WebSocket local sem TLS. O SHA-256 confere integridade, sem criptografar os arquivos em trânsito.
