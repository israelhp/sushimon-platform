-- ================================================================================================
-- 0020_payments_hash_not_null · F24 (pagos en efectivo) · corrección de 0019
-- ------------------------------------------------------------------------------------------------
-- DEFECTO CORREGIDO: en `payments_reception_chk` (0019) la rama `paid` terminaba en
--   octet_length("confirm_key_hash") = 32 AND octet_length("confirm_request_hash") = 32
-- y `octet_length(NULL)` es NULL: un CHECK solo falla con FALSE, así que un pago `paid` SIN hash de la
-- clave o SIN hash del cuerpo se aceptaba (detectado por migration-0019.int-spec.ts en la base desechable
-- de CI; esa suite se omite contra el Supabase compartido). Se añade `IS NOT NULL` explícito a ambos.
--
-- ALCANCE: solo reemplaza esa restricción CHECK. NO modifica datos, columnas, índices ni triggers y NO
-- borra nada. Si existiera un pago `paid` con algún hash nulo, el ADD CONSTRAINT FALLA (es lo correcto:
-- avisaría de datos incoherentes en vez de aceptarlos); con la 0019 recién aplicada no hay pagos `paid`.
-- Reversión manual: ALTER TABLE app.payments DROP CONSTRAINT payments_reception_chk y volver a crearla
-- con la definición de 0019 (más débil; no recomendado).
-- ================================================================================================
ALTER TABLE "app"."payments" DROP CONSTRAINT IF EXISTS "payments_reception_chk";
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_reception_chk" CHECK (
    ("status" = 'pending'
        AND "tendered_amount" IS NULL AND "change_amount" IS NULL AND "collector_type" IS NULL
        AND "received_by_staff_id" IS NULL AND "collection_context" IS NULL AND "received_at" IS NULL
        AND "confirm_key_hash" IS NULL AND "confirm_request_hash" IS NULL)
    OR ("status" = 'paid'
        AND "amount" > 0
        AND "tendered_amount" IS NOT NULL AND "tendered_amount" >= "amount"
        AND "change_amount" IS NOT NULL AND "change_amount" = "tendered_amount" - "amount"
        AND "collector_type" = 'STAFF' AND "received_by_staff_id" IS NOT NULL
        AND "collection_context" IN ('BRANCH', 'OWN_DELIVERY') AND "received_at" IS NOT NULL
        AND "confirm_key_hash" IS NOT NULL AND octet_length("confirm_key_hash") = 32
        AND "confirm_request_hash" IS NOT NULL AND octet_length("confirm_request_hash") = 32)
);
