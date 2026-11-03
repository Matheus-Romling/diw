# Modelagem — via — Aluguel de Automóveis

Esta modelagem documenta o protótipo disponível no repositório. Os diagramas usam Mermaid e podem ser visualizados no GitHub ou em um editor compatível.

Os arquivos JavaScript implementam a aplicação com funções e objetos; o diagrama de classes representa os conceitos dos dados, sem pressupor classes JavaScript no código. Empresas, bancos e contratos do enunciado completo ainda não fazem parte da implementação.

## Casos de uso

O desenho representa os atores e os casos de uso com a notação de fluxo disponível no Mermaid.

```mermaid
flowchart LR
    V[Visitante] --> UC1([Consultar e filtrar a frota])
    V --> UC2([Criar conta de cliente])
    V --> UC3([Entrar na conta])
    C[Cliente autenticado] --> UC4([Criar reserva])
    C --> UC5([Consultar suas reservas])
    C --> UC6([Modificar ou cancelar sua reserva])
    C --> UC7([Consultar e editar seus dados])
    C --> UC8([Excluir conta sem reservas])
    A[Administrador autenticado] --> UC9([Cadastrar, editar e excluir veículo])
    A --> UC10([Alterar disponibilidade])
    A --> UC11([Consultar, aprovar e cancelar reservas])
    A --> UC12([Consultar e excluir clientes])
    A --> UC3
    C --> UC3
```

Não existe caso de uso para criar administradores. As três contas são previamente definidas no banco. A exclusão de clientes e veículos vinculados a pedidos é recusada para preservar o histórico.

## Histórias de usuário

| ID | História | Critério de aceitação principal |
|---|---|---|
| HU01 | Como visitante, quero consultar a frota antes de criar uma conta. | O início apresenta uma linha de carros, filtro de categoria e a opção de expandir/recolher. |
| HU02 | Como visitante, quero criar uma conta para reservar um veículo. | O cadastro valida os dados, a confirmação da senha e a unicidade de CPF e e-mail; cria somente cliente. |
| HU03 | Como cliente, quero continuar a reserva após entrar na conta. | O carro escolhido antes do login permanece selecionado ao retornar. |
| HU04 | Como cliente, quero reservar um carro para um período. | O servidor valida as datas, a disponibilidade e conflitos e calcula o total pela diária. |
| HU05 | Como cliente, quero alterar ou cancelar meu pedido. | Somente o titular pode modificar seu pedido; pedidos cancelados permanecem no histórico. |
| HU06 | Como cliente, quero acompanhar o resultado da análise. | A lista exibe os estados Pendente, Aprovado e Cancelado. |
| HU07 | Como administrador, quero gerenciar a frota. | É possível cadastrar e editar veículos, alterar sua disponibilidade e excluir apenas carros sem pedidos vinculados. |
| HU08 | Como administrador, quero analisar os pedidos de todos os clientes. | O painel permite filtrar por status, aprovar e cancelar reservas; o servidor verifica o perfil. |
| HU09 | Como cliente, quero controlar meus dados cadastrais. | A conta permite edição e recusa exclusão quando houver pedidos associados. |

## Diagrama de classes conceitual

```mermaid
classDiagram
    class Cliente {
        +String id
        +String nome
        +String cpf
        +String email
        +String telefone
        +String endereco
        +String profissao
        -String senhaSalt
        -String senhaHash
    }
    class Administrador {
        +String id
        +String nome
        +String email
        +String perfil
        -String senhaSalt
        -String senhaHash
    }
    class Veiculo {
        +String id
        +String matricula
        +String marca
        +String modelo
        +int ano
        +String placa
        +String categoria
        +String cambio
        +int lugares
        +String combustivel
        +number diaria
        +boolean disponivel
        +String corVisual
        +String imagemArquivo
    }
    class Pedido {
        +String id
        +String clienteId
        +String veiculoId
        +String dataInicio
        +String dataFim
        +number diaria
        +number total
        +String status
        +String criadoEm
    }
    Cliente "1" --> "0..*" Pedido : realiza
    Veiculo "1" --> "0..*" Pedido : associado a
    Administrador ..> Veiculo : gerencia
    Administrador ..> Pedido : avalia
    Administrador ..> Cliente : consulta
```

O status do pedido é uma das strings `Pendente`, `Aprovado` ou `Cancelado`. Os vínculos usam `clienteId` e `veiculoId`. Anotações de senhas da massa de demonstração são metadados locais, sem participação no processo de autenticação. Os campos de hash e salt representam as contas autenticáveis; sua ausência nos dois clientes de demonstração é uma pendência da massa atual.

## Diagrama de pacotes — visão lógica

```mermaid
flowchart TB
    subgraph Publico[public]
        Site[index.html e script.js]
        Login[login: cadastro, entrada e comunicação com API]
        Admin[admin: painel de gestão]
        Estilo[style.css e estilos dos módulos]
        Site --> Login
        Admin --> Login
        Site --> Estilo
        Admin --> Estilo
    end
    Backend[server.mjs: rotas, validação e permissões]
    Persistencia[Lowdb e db.json]
    Testes[tests/admin.test.mjs]
    Site --> Backend
    Login --> Backend
    Admin --> Backend
    Backend --> Persistencia
    Testes -. valida .-> Backend
```

## Diagrama de componentes

```mermaid
flowchart LR
    Navegador[Navegador: HTML, CSS, JavaScript e Bootstrap]
    API[API HTTP: server.mjs]
    Auth[Autenticação e sessões em memória]
    Regras[Validação de clientes, veículos e reservas]
    Lowdb[Lowdb: JSONFile]
    Banco[(db.json)]
    Fotos[Wikimedia Commons: Imageinfo]
    Navegador -->|Fetch e JSON| API
    API --> Auth
    API --> Regras
    Regras --> Lowdb
    Lowdb --> Banco
    Navegador -->|Consulta de fotos e créditos| Fotos
```

## Revisão dos modelos

| Registro | Descrição |
|---|---|
| 03/11/2026 — documentação da versão atual | Modelagem alinhada à separação em `public/`, às contas administrativas predefinidas, à frota de 20 carros e à API Node.js com Lowdb. |

O material original disponível inclui o enunciado e o template de README. Não há versões anteriores dos diagramas na pasta `documents/`; este arquivo registra a modelagem da implementação atual, sem atribuir a ela um histórico anterior.
