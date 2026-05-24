# Run this in Supabase SQL Editor

```sql
alter table profiles add column if not exists banner_position text not null default 'center';
alter table groups   add column if not exists banner_position text not null default 'center';
```

Delete this file once applied.
