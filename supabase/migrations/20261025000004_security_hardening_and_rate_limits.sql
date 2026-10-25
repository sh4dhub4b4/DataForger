-- 20261025000004_security_hardening_and_rate_limits.sql
-- Complete Security Hardening: Revoke RPC execution, add Anti-Spam Triggers & Sybil Throttling

-- 1. CRITICAL: Lockdown upsert_scraped_batch
-- Only backend service_role can mutate scraped products. Revoke from anon and public.
REVOKE EXECUTE ON FUNCTION public.upsert_scraped_batch(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_scraped_batch(JSONB) TO service_role;

-- 2. Input Integrity Constraints on Comments & Community Posts
ALTER TABLE public.comments
    DROP CONSTRAINT IF EXISTS chk_comment_text_len,
    ADD CONSTRAINT chk_comment_text_len CHECK (length(trim(comment_text)) >= 3 AND length(comment_text) <= 2500);

ALTER TABLE public.comments
    DROP CONSTRAINT IF EXISTS chk_user_name_len,
    ADD CONSTRAINT chk_user_name_len CHECK (length(trim(user_name)) >= 2 AND length(user_name) <= 60);

ALTER TABLE public.community_posts
    DROP CONSTRAINT IF EXISTS chk_post_title_len,
    ADD CONSTRAINT chk_post_title_len CHECK (length(trim(title)) >= 5 AND length(title) <= 160);

ALTER TABLE public.community_posts
    DROP CONSTRAINT IF EXISTS chk_post_content_len,
    ADD CONSTRAINT chk_post_content_len CHECK (length(trim(content)) >= 10 AND length(content) <= 5000);

-- 3. Anti-Spam Velocity Trigger for Comments (Max 6 comments per hour per phone)
CREATE OR REPLACE FUNCTION public.check_comment_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
    recent_count INT;
BEGIN
    SELECT COUNT(*) INTO recent_count
    FROM public.comments
    WHERE user_phone = NEW.user_phone
      AND created_at > now() - INTERVAL '1 hour';

    IF recent_count >= 6 THEN
        RAISE EXCEPTION 'Rate limit exceeded: Maximum 6 reviews per hour per verified phone number.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_comment_rate_limit ON public.comments;
CREATE TRIGGER trg_comment_rate_limit
    BEFORE INSERT ON public.comments
    FOR EACH ROW
    EXECUTE FUNCTION public.check_comment_rate_limit();

-- 4. Anti-Spam Velocity Trigger for Community Posts (Max 4 posts per hour per phone)
CREATE OR REPLACE FUNCTION public.check_post_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
    recent_count INT;
BEGIN
    SELECT COUNT(*) INTO recent_count
    FROM public.community_posts
    WHERE author_phone = NEW.author_phone
      AND created_at > now() - INTERVAL '1 hour';

    IF recent_count >= 4 THEN
        RAISE EXCEPTION 'Rate limit exceeded: Maximum 4 community discussions per hour per phone number.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_post_rate_limit ON public.community_posts;
CREATE TRIGGER trg_post_rate_limit
    BEFORE INSERT ON public.community_posts
    FOR EACH ROW
    EXECUTE FUNCTION public.check_post_rate_limit();

-- 5. Anti-Sybil Upvote Throttling (Max 35 upvotes per hour per phone)
CREATE OR REPLACE FUNCTION public.check_upvote_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
    recent_count INT;
BEGIN
    SELECT COUNT(*) INTO recent_count
    FROM public.deal_upvotes
    WHERE user_phone = NEW.user_phone
      AND created_at > now() - INTERVAL '1 hour';

    IF recent_count >= 35 THEN
        RAISE EXCEPTION 'Sybil alert: Upvote frequency exceeded threshold. Please wait before voting again.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_upvote_rate_limit ON public.deal_upvotes;
CREATE TRIGGER trg_upvote_rate_limit
    BEFORE INSERT ON public.deal_upvotes
    FOR EACH ROW
    EXECUTE FUNCTION public.check_upvote_rate_limit();

-- 6. Outbound Clicks Rate Limiting (Mitigate DDoS on click tracking)
CREATE OR REPLACE FUNCTION public.check_outbound_click_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
    recent_clicks INT;
BEGIN
    SELECT COUNT(*) INTO recent_clicks
    FROM public.outbound_clicks
    WHERE product_id = NEW.product_id
      AND created_at > now() - INTERVAL '1 minute';

    -- Drop clicks if spamming single product faster than 60 clicks/min
    IF recent_clicks >= 60 THEN
        RETURN NULL; -- Silently drop spam click to save database storage
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_outbound_click_rate_limit ON public.outbound_clicks;
CREATE TRIGGER trg_outbound_click_rate_limit
    BEFORE INSERT ON public.outbound_clicks
    FOR EACH ROW
    EXECUTE FUNCTION public.check_outbound_click_rate_limit();
