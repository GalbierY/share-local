# Share Local 0.5.0

## Novidades

- **Painel lateral para jogar:** minimizar durante uma conexão abre um painel compacto sobre os outros aplicativos, com imagem recebida, participantes, avisos de conversa e arquivos, volume e controles de transmissão. O painel pode ficar à esquerda ou à direita, com opacidade de 80% a 100%. Voltar à sala restaura o tamanho anterior; Ocultar painel permite usar a barra de tarefas.
- **Preferências salvas:** volume recebido, áudio compartilhado, qualidade, notificações, comportamento ao minimizar, transparência, lado do painel e tamanho e posição da janela normal.
- **Qualidade da transmissão:** Automático até 1080p, Econômico até 720p/20 quadros por segundo e Mais nítido até 1440p/30 quadros por segundo. A transmissão adapta a taxa de envio à conexão dentro do limite escolhido.
- **Recuperação da conexão:** novas tentativas ICE para oscilações da transmissão e do canal protegido. Uma queda da sala encerra as capturas e oferece um novo pedido de entrada, preservando endereço e preferências, sem retomar a tela automaticamente.
- **Notificações discretas:** pedidos de entrada, mensagens e arquivos quando você está em outro aplicativo. Sem som e com opção de desativar; mensagens e nomes de arquivos não aparecem no aviso do Windows.
- **Fila de arquivos:** escolha vários ou arraste para a sala. O envio acontece um por vez, com aceite individual, progresso, verificação de integridade e cancelamento. É possível remover pendentes ou limpar a fila; uma desconexão cancela os envios.
- **Pausar e retomar:** bloquear temporariamente imagem e áudio da sua transmissão sem sair da sala. A outra pessoa vê um aviso de pausa nas versões compatíveis. Parar também cancela uma captura ainda em preparação.
- **Atalhos durante a sala:** Ctrl+Shift+M para áudio recebido, Ctrl+Shift+P para pausar ou retomar, Ctrl+Shift+S para parar e Ctrl+Shift+O para alternar o painel. Atalhos ocupados por outro aplicativo são indicados nas preferências.
- **Conversa e arquivos criptografados:** canal WebRTC com DTLS, independente da transmissão de tela. As duas pontas exibem um código que pode ser comparado por um meio de confiança. O aplicativo não recorre a envio de mensagens ou arquivos sem criptografia.
- **Perfis mais pessoais:** foto própria com prévia, recorte, zoom e ajuste de posição, além de My Melody e Poporing. Zahir, Emma e Priya têm ilustrações e descrições padronizadas. Cancelar preserva o perfil salvo.

## Atualização e limites

Atualize os dois computadores para a 0.5.0. A conexão com a 0.3.0 e a 0.4.0 continua funcionando para tela e áudio; conversa e arquivos ficam desativados nessas conexões. Fotos e personagens novos aparecem como Zahir nas versões antigas.

O painel é uma janela do Windows sempre sobre os outros aplicativos; funciona melhor com jogos em janela ou sem bordas. Jogos em tela cheia exclusiva podem ocultá-lo. Ele não injeta componentes no jogo. Fechar o painel encerra o aplicativo e as capturas; use Voltar à sala ou Ocultar painel para continuar conectado.

O aplicativo continua limitado a duas pessoas na mesma rede de confiança. Tela, áudio, conversa e conteúdo dos arquivos usam WebRTC criptografado. Perfis, pedidos de entrada, IPs e sinalização ainda usam o WebSocket local sem TLS; a autorização não prova por si só a identidade da pessoa. Compare o código do canal protegido por voz ou por outro meio de confiança. O instalador ainda não possui assinatura digital.
