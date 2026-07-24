# Diagrama Entidade-Relacionamento — FinControl AI

Renderiza automaticamente no GitHub (Mermaid).

```mermaid
erDiagram
    users ||--o{ accounts : possui
    users ||--o{ cards : possui
    users ||--o{ categories : define
    users ||--o{ transactions : registra
    users ||--o{ investments : possui
    users ||--o{ loans : possui
    users ||--o{ subscriptions : assina
    users ||--o{ goals : define
    users ||--o{ budgets : planeja

    accounts ||--o{ transactions : origem
    cards ||--o{ transactions : origem
    cards ||--o{ invoices : gera
    invoices ||--o{ transactions : agrupa
    categories ||--o{ transactions : classifica
    categories ||--o{ budgets : limita
    transactions ||--o{ installments : parcela
    loans ||--o{ installments : gera

    users {
        uuid id PK
        text nome
        text email
        text moeda
        numeric reserva_emergencia_meta
        timestamptz created_at
    }
    accounts {
        uuid id PK
        uuid user_id FK
        text nome
        text tipo
        text banco
        text numero_mascarado
        numeric saldo_inicial
        boolean ativa
    }
    cards {
        uuid id PK
        uuid user_id FK
        uuid account_id FK
        text nome
        text bandeira
        text numero_mascarado
        numeric limite
        int dia_fechamento
        int dia_vencimento
    }
    categories {
        uuid id PK
        uuid user_id FK
        text nome
        text tipo
        text cor
        text icone
        uuid parent_id FK
    }
    transactions {
        uuid id PK
        uuid user_id FK
        uuid account_id FK
        uuid card_id FK
        uuid category_id FK
        uuid invoice_id FK
        text descricao
        numeric valor
        text tipo
        date data
        text recorrencia
        text estabelecimento
        boolean conciliada
    }
    installments {
        uuid id PK
        uuid user_id FK
        uuid transaction_id FK
        uuid loan_id FK
        int numero
        int total
        numeric valor
        date vencimento
        boolean paga
    }
    invoices {
        uuid id PK
        uuid user_id FK
        uuid card_id FK
        date competencia
        date fechamento
        date vencimento
        numeric total
        text status
    }
    investments {
        uuid id PK
        uuid user_id FK
        text nome
        text tipo
        numeric valor_aplicado
        numeric valor_atual
        numeric rentabilidade
        date data_aplicacao
    }
    loans {
        uuid id PK
        uuid user_id FK
        text nome
        text tipo
        numeric valor_total
        numeric taxa_juros
        int parcelas_total
        int parcelas_pagas
        date inicio
    }
    subscriptions {
        uuid id PK
        uuid user_id FK
        uuid card_id FK
        text nome
        numeric valor
        int dia_cobranca
        text ciclo
        boolean ativa
    }
    goals {
        uuid id PK
        uuid user_id FK
        text nome
        numeric valor_alvo
        numeric valor_atual
        date prazo
        text status
    }
    budgets {
        uuid id PK
        uuid user_id FK
        uuid category_id FK
        date competencia
        numeric limite
    }
```

> Observação: `users` reflete a tabela de perfil da aplicação. O `id` corresponde ao
> `auth.users.id` do Supabase (relação 1-1), permitindo o uso de `auth.uid()` nas políticas RLS.
