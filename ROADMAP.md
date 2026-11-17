# Melhorias escolhidas

## 0.4.0 — escopo reunido

- **1. Nome e avatar:** perfil local, identificação nos pedidos e na sala, edição durante a conexão.
- **2. Conexão mais amigável:** orientações, nova tentativa com autorização e contagem regressiva dos pedidos.
- **3. Controles de áudio:** opção de transmitir apenas imagem, volume recebido e proteção contra retorno quando o áudio é enviado.
- **5. Trocar a tela:** mudar de monitor ou janela mantendo a sala e a conexão; preservar a fonte anterior se a troca falhar.
- **6. Janela flutuante:** acompanhar a transmissão sobre os outros aplicativos, com acesso a volume, silêncio e retorno ao tamanho anterior.
- **9. Chat na sala:** mensagens e links entre as duas pessoas, com identificação pelo perfil local e histórico apenas da conexão atual.
- **10. Transferência de arquivos:** aceite ou recusa, escolha de destino, progresso, cancelamento e verificação de integridade, preservando arquivos existentes e sem abrir ou executar o recebido.
- **12. Convites clicáveis:** abrir o aplicativo com a sala preenchida, aceitar convite colado e escolher o IP quando houver mais de uma rede.

Os itens antes separados para 0.5.0 e 0.6.0 foram incluídos na 0.4.0 por escolha do usuário. As oito melhorias selecionadas estão nesta versão. O foco continua em duas pessoas na mesma rede, sem cadastro.

## 0.5.0 — conforto, estabilidade e painel lateral

- Prévia do nome e avatar antes de salvar, com cancelamento que preserva o perfil atual.
- Foto própria com recorte, zoom e posição; imagem estática reduzida e salva localmente.
- My Melody e Poporing na seleção, junto dos três gatos com ilustrações e descrições padronizadas.
- Atualização do perfil na sala e compatibilidade com versões antigas, que exibem um avatar padrão para fotos e personagens novos.
- Preferências salvas: volume, áudio, qualidade, notificações, janela e painel lateral.
- Qualidade Automático, Econômico e Mais nítido, ajustável durante a transmissão.
- Recuperação ICE e nova entrada guiada depois de uma queda da sala, sem retomar capturas automaticamente.
- Notificações silenciosas para pedidos, mensagens e arquivos, com opção de desativar.
- Seleção de vários arquivos, arrastar para enviar, fila sequencial e aceite individual.
- Pausa real de imagem e áudio e atalhos globais durante a conexão.
- Conversa e arquivos pelo canal WebRTC com DTLS e código para conferência; versões antigas mantêm apenas mídia.
- Painel lateral ao minimizar, sempre sobre os outros aplicativos, com transparência e lado configuráveis.

Validação automatizada concluída: 30 testes, teste completo do aplicativo e do executável empacotado, fontes do pacote, manifesto e SHA-512 do instalador. Validação manual pendente: dois PCs físicos, atualização instalada desde a 0.4.0 e painel com jogos em janela e sem bordas. Tela cheia exclusiva depende do comportamento do jogo.
