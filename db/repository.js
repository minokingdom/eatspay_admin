function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    loginId: row.login_id || row.email,
    contactEmail: row.contact_email,
    passwordHash: row.password_hash,
    name: row.name,
    franchiseName: row.franchise_name,
    franchiseId: row.franchise_id,
    role: row.role,
    adminLevel: row.admin_level || null,
    adminPermissions: Array.isArray(row.admin_permissions) ? row.admin_permissions : null,
    adminActive: row.admin_active !== false,
    lastLoginAt: row.last_login_at,
    balance: Number(row.balance || 0),
    phone: row.phone,
    address: row.address,
    tel: row.tel,
    businessNumber: row.business_number,
    franchiseFeeRate: row.franchise_fee_rate === null || row.franchise_fee_rate === undefined ? null : Number(row.franchise_fee_rate),
    customerId: row.customer_id,
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    bizDocFileKey: row.biz_doc_file_key,
    bizDocFileName: row.biz_doc_original_name,
    posFileKey: row.pos_file_key,
    signupSource: row.signup_source,
    signupAgencyId: row.signup_agency_id,
    signupJoinCode: row.signup_join_code,
    createdAt: row.created_at
  };
}

function toAuditLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    actorLoginId: row.actor_login_id,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityName: row.entity_name,
    beforeData: row.before_data || {},
    afterData: row.after_data || {},
    changedFields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
    requestMethod: row.request_method,
    requestPath: row.request_path,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function toAgencyAuth(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.login_id,
    loginId: row.login_id,
    contactEmail: '',
    passwordHash: row.password_hash,
    name: row.owner || row.name,
    franchiseName: row.name,
    franchiseId: null,
    role: 'AGENCY',
    agencyId: row.id,
    agencyName: row.name,
    agencyType: row.type,
    agencyLevel: Number(row.level || (row.type === 'HQ' ? 1 : 3)),
    agencyParentId: row.parent_id,
    phone: row.phone,
    address: row.address,
    tel: row.phone,
    businessNumber: null,
    adminActive: true,
    joinCode: row.join_code
  };
}

function toTransaction(row) {
  if (!row) return null;
  return {
    transactionId: row.transaction_id,
    franchiseId: row.franchise_id,
    type: row.type,
    amount: Number(row.amount),
    fee: Number(row.fee),
    totalAmount: Number(row.total_amount),
    method: row.method,
    cardDetails: row.card_details,
    pg: row.pg || '',
    pgTxId: row.pg_tx_id || '',
    authCode: row.auth_code || '',
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function toAccountRequest(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    franchiseId: row.franchise_id,
    franchiseName: row.franchise_name,
    businessNumber: row.business_number,
    bankCode: row.bank_code,
    bankName: row.bank_name,
    deliveryAgencyName: row.delivery_agency_name,
    accountNo: row.account_no,
    representativeName: row.representative_name,
    status: row.status,
    documentUrl: row.document_url,
    documentOriginalName: row.document_original_name,
    submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at,
    assignedVirtualAccount: row.assigned_virtual_account,
    rejectionReason: row.rejection_reason,
    exportReadyAt: row.export_ready_at instanceof Date ? row.export_ready_at.toISOString() : row.export_ready_at,
    exportBatchId: row.export_batch_id,
    exportedAt: row.exported_at instanceof Date ? row.exported_at.toISOString() : row.exported_at,
    txid: row.txid,
    txidUploadedAt: row.txid_uploaded_at instanceof Date ? row.txid_uploaded_at.toISOString() : row.txid_uploaded_at,
    active: row.active !== false,
    hidden: row.hidden === true
  };
}

function toStoredFile(row) {
  if (!row) return null;
  return {
    fileKey: row.file_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
    publicUrl: row.public_url,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function toDeliveryAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    franchiseId: row.franchise_id,
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    bankName: row.bank_name,
    accountHolder: row.account_holder,
    accountNo: row.account_no,
    fileKey: row.file_key,
    originalName: row.original_name,
    accountStatus: row.account_status,
    rejectionReason: row.rejection_reason,
    approvedAt: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at,
    exportReadyAt: row.export_ready_at instanceof Date ? row.export_ready_at.toISOString() : row.export_ready_at,
    exportBatchId: row.export_batch_id,
    exportedAt: row.exported_at instanceof Date ? row.exported_at.toISOString() : row.exported_at,
    txid: row.txid,
    txidUploadedAt: row.txid_uploaded_at instanceof Date ? row.txid_uploaded_at.toISOString() : row.txid_uploaded_at,
    active: row.active !== false,
    hidden: row.hidden === true,
    reqDate: row.req_date instanceof Date ? row.req_date.toISOString() : row.req_date
  };
}

function normalizeAccountNo(value) {
  return String(value || '').replace(/[^0-9A-Za-z]/g, '');
}

function isValidAccountApprovalTxid(value) {
  return /^T\d{12}$/.test(String(value || '').trim());
}

function deliveryAccountDedupeKey(account) {
  return [
    String(account?.agencyId || ''),
    String(account?.agencyName || '').trim().toLowerCase(),
    String(account?.bankName || '').trim().toLowerCase(),
    normalizeAccountNo(account?.accountNo),
    String(account?.accountHolder || '').trim().toLowerCase()
  ].join('|');
}

function dedupeDeliveryAccountInput(accounts = []) {
  const seen = new Set();
  return accounts.filter(account => {
    const key = deliveryAccountDedupeKey(account);
    if (!normalizeAccountNo(account?.accountNo) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseProviderDateTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const compact = raw.replace(/[^0-9]/g, '');
  if (compact.length >= 14) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    const hh = Number(compact.slice(8, 10));
    const mm = Number(compact.slice(10, 12));
    const ss = Number(compact.slice(12, 14));
    if (y && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      // Provider timestamps are Korea local time unless an explicit timezone is sent.
      return new Date(Date.UTC(y, m - 1, d, hh - 9, mm, ss));
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function findProviderSettlementTime(payload) {
  const candidates = [];
  const strongKeys = new Set([
    'settledat',
    'settleat',
    'settledate',
    'settledatetime',
    'settlementat',
    'settlementdate',
    'settlementdatetime',
    'depositat',
    'depositdate',
    'depositdatetime',
    '입금일시',
    '입금일자',
    '정산일시',
    '정산일자'
  ]);

  function visit(value, key = '') {
    if (value == null) return;
    const normalizedKey = String(key || '').replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();
    if (typeof value !== 'object') {
      if (
        strongKeys.has(normalizedKey) ||
        (
          (normalizedKey.includes('settle') || normalizedKey.includes('settlement') || normalizedKey.includes('deposit') || normalizedKey.includes('정산') || normalizedKey.includes('입금')) &&
          !normalizedKey.includes('amount') &&
          !normalizedKey.includes('amt') &&
          !normalizedKey.includes('code') &&
          !normalizedKey.includes('id')
        )
      ) {
        const parsed = parseProviderDateTime(value);
        if (parsed) candidates.push(parsed);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(item => visit(item, key));
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  }

  visit(payload);
  return candidates[0] || null;
}

function toPgSettlement(row) {
  if (!row) return null;
  return {
    id: row.id,
    settledAt: row.settled_at instanceof Date ? row.settled_at.toISOString() : row.settled_at,
    approvalNo: row.approval_no,
    pg: row.pg,
    pgTxId: row.pg_tx_id,
    franchiseId: row.franchise_id,
    franchiseName: row.franchise_name,
    paymentAmt: Number(row.payment_amt),
    svcFee: Number(row.svc_fee),
    netAmt: Number(row.net_amt),
    agencyId: row.resolved_agency_id || row.agency_id,
    agencyName: row.resolved_agency_name || row.agency_name,
    customerId: row.customer_id,
    bankCode: row.bank_code,
    accountNo: row.account_no,
    deliveryAgency: row.delivery_agency,
    status: row.status
  };
}

function toPgProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mid: row.mid || '',
    apiKey: row.api_key || '',
    callbackUrl: row.callback_url || '',
    status: row.status || '활성',
    note: row.note || '',
    displayOrder: Number(row.display_order || 0),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function toBoardPost(row) {
  if (!row) return null;
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;
  return {
    id: row.id,
    boardType: row.board_type,
    type: row.board_type,
    title: row.title,
    author: row.author,
    content: row.content,
    active: row.active,
    date: createdAt ? String(createdAt).slice(0, 10) : '',
    createdAt,
    updatedAt
  };
}

function toFaq(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    question: row.question,
    answer: row.answer,
    active: row.active,
    displayOrder: Number(row.display_order || 0),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function toBanner(row) {
  if (!row) return null;
  const startAt = row.start_at instanceof Date ? row.start_at.toISOString() : row.start_at;
  const endAt = row.end_at instanceof Date ? row.end_at.toISOString() : row.end_at;
  return {
    id: row.id,
    type: row.type || '메인',
    title: row.title || '',
    subtitle: row.subtitle || '',
    url: row.url || '',
    imageUrl: row.image_url || '',
    detailTitle: row.detail_title || '',
    detailSubtitle: row.detail_subtitle || '',
    detailImageUrl: row.detail_image_url || '',
    status: row.status || '활성',
    order: Number(row.display_order || 0),
    displayOrder: Number(row.display_order || 0),
    startAt,
    endAt,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function toLegalDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    sourceFileName: row.source_file_name,
    applied: row.applied,
    appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function toTalkPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    franchiseId: row.franchise_id,
    franchiseName: row.franchise_name,
    title: row.title,
    body: row.body,
    price: Number(row.price || 0),
    imageUrl: row.image_url,
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
    status: row.status,
    tradeStatus: row.trade_status || 'SALE',
    sellerAddress: row.seller_address || '',
    sellerLatitude: row.seller_latitude == null ? null : Number(row.seller_latitude),
    sellerLongitude: row.seller_longitude == null ? null : Number(row.seller_longitude),
    viewCount: Number(row.view_count || 0),
    chatCount: Number(row.chat_count || 0),
    likeCount: Number(row.like_count || 0),
    likedByMe: row.liked_by_me === true,
    commentCount: Number(row.comment_count || 0),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function toTalkComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id,
    userId: row.user_id,
    userName: row.user_name || row.franchise_name || '',
    comment: row.comment,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function toTalkChat(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    sellerUserId: row.seller_user_id,
    buyerUserId: row.buyer_user_id,
    postTitle: row.post_title,
    franchiseName: row.franchise_name,
    sellerName: row.seller_name,
    buyerName: row.buyer_name,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at instanceof Date ? row.last_message_at.toISOString() : row.last_message_at,
    unreadCount: Number(row.unread_count || 0),
    sellerLeftAt: row.seller_left_at instanceof Date ? row.seller_left_at.toISOString() : row.seller_left_at,
    buyerLeftAt: row.buyer_left_at instanceof Date ? row.buyer_left_at.toISOString() : row.buyer_left_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function toTalkMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    message: row.message,
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function toAgencyInquiry(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    deliveryAgency: row.delivery_agency || '',
    region: row.region || '',
    handler: row.handler || '',
    status: row.status || '상담 대기',
    date: row.created_at instanceof Date ? row.created_at.toISOString().slice(0, 10) : String(row.created_at || '').slice(0, 10),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function normalizePolicyMonth(value) {
  const source = value ? new Date(`${String(value).slice(0, 7)}-01T00:00:00Z`) : new Date();
  const year = source.getUTCFullYear();
  const month = String(source.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

function toNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data || {},
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function createRepository(pool) {
  return {
    async listTalkPosts({ limit = 20, offset = 0, viewerUserId = null, likedOnly = false } = {}) {
      const params = [limit, offset, viewerUserId || null];
      const likedOnlyClause = likedOnly ? 'AND viewer_like.user_id IS NOT NULL' : '';
      const result = await pool.query(
        `SELECT p.*,
                users.address AS seller_address,
                COALESCE(likes.like_count, 0)::int AS like_count,
                COALESCE(chats.chat_count, 0)::int AS chat_count,
                COALESCE(comments.comment_count, 0)::int AS comment_count,
                (viewer_like.user_id IS NOT NULL) AS liked_by_me
         FROM talk_posts p
         LEFT JOIN users ON users.id = p.user_id
         LEFT JOIN (
           SELECT post_id, count(*)::int AS like_count
           FROM talk_post_likes
           GROUP BY post_id
         ) likes ON likes.post_id = p.id
         LEFT JOIN (
          SELECT post_id, count(*)::int AS chat_count
          FROM talk_chats
          GROUP BY post_id
          ) chats ON chats.post_id = p.id
         LEFT JOIN (
           SELECT post_id, count(*)::int AS comment_count
           FROM talk_comments
           WHERE status = 'ACTIVE'
           GROUP BY post_id
         ) comments ON comments.post_id = p.id
          LEFT JOIN talk_post_likes viewer_like
            ON viewer_like.post_id = p.id AND viewer_like.user_id = $3
          WHERE p.status = 'ACTIVE'
            ${likedOnlyClause}
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT $1 OFFSET $2`,
        params
      );
      return result.rows.map(toTalkPost);
    },

    async countTalkPosts({ viewerUserId = null, likedOnly = false } = {}) {
      const likedOnlyJoin = likedOnly ? 'JOIN talk_post_likes viewer_like ON viewer_like.post_id = p.id AND viewer_like.user_id = $1' : '';
      const params = likedOnly ? [viewerUserId || 0] : [];
      const result = await pool.query(
        `SELECT count(*)::int AS count
         FROM talk_posts p
         ${likedOnlyJoin}
         WHERE p.status = 'ACTIVE'`,
        params
      );
      return Number(result.rows[0]?.count || 0);
    },

    async findTalkPostById(id) {
      const result = await pool.query(
        `SELECT p.*,
                users.address AS seller_address,
                COALESCE(likes.like_count, 0)::int AS like_count,
                COALESCE(chats.chat_count, 0)::int AS chat_count,
                COALESCE(comments.comment_count, 0)::int AS comment_count,
                false AS liked_by_me
         FROM talk_posts p
         LEFT JOIN users ON users.id = p.user_id
         LEFT JOIN (
           SELECT post_id, count(*)::int AS like_count
           FROM talk_post_likes
           GROUP BY post_id
         ) likes ON likes.post_id = p.id
         LEFT JOIN (
          SELECT post_id, count(*)::int AS chat_count
          FROM talk_chats
          GROUP BY post_id
         ) chats ON chats.post_id = p.id
         LEFT JOIN (
           SELECT post_id, count(*)::int AS comment_count
           FROM talk_comments
           WHERE status = 'ACTIVE'
           GROUP BY post_id
         ) comments ON comments.post_id = p.id
         WHERE p.id = $1 AND p.status = 'ACTIVE'`,
        [id]
      );
      return toTalkPost(result.rows[0]);
    },

    async incrementTalkPostView(id) {
      const result = await pool.query(
        `UPDATE talk_posts
         SET view_count = COALESCE(view_count, 0) + 1,
             updated_at = now()
         WHERE id = $1 AND status = 'ACTIVE'
         RETURNING view_count`,
        [id]
      );
      return Number(result.rows[0]?.view_count || 0);
    },

    async getTalkPostLikeState(postId, userId) {
      const result = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM talk_post_likes WHERE post_id = $1) AS like_count,
           EXISTS(SELECT 1 FROM talk_post_likes WHERE post_id = $1 AND user_id = $2) AS liked_by_me`,
        [postId, userId]
      );
      return {
        likeCount: Number(result.rows[0]?.like_count || 0),
        likedByMe: result.rows[0]?.liked_by_me === true
      };
    },

    async toggleTalkPostLike({ postId, userId }) {
      const existing = await pool.query(
        'SELECT 1 FROM talk_post_likes WHERE post_id = $1 AND user_id = $2',
        [postId, userId]
      );
      if (existing.rowCount) {
        await pool.query('DELETE FROM talk_post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
      } else {
        await pool.query(
          `INSERT INTO talk_post_likes (post_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (post_id, user_id) DO NOTHING`,
          [postId, userId]
        );
      }
      return this.getTalkPostLikeState(postId, userId);
    },

    async createTalkReport({ reporterUserId, postId = null, chatId = null, messageId = null, reason, detail = '' }) {
      const result = await pool.query(
        `INSERT INTO talk_reports (reporter_user_id, post_id, chat_id, message_id, reason, detail)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [reporterUserId, postId, chatId, messageId, reason, detail]
      );
      return result.rows[0] || null;
    },

    async updateTalkPostTradeStatus({ id, userId, tradeStatus }) {
      const result = await pool.query(
        `UPDATE talk_posts
         SET trade_status = $3,
             updated_at = now()
         WHERE id = $1
           AND user_id = $2
           AND status = 'ACTIVE'
         RETURNING *`,
        [id, userId, tradeStatus]
      );
      return toTalkPost(result.rows[0]);
    },

    async createTalkPost(post) {
      const result = await pool.query(
        `INSERT INTO talk_posts (
           user_id, franchise_id, franchise_name, title, body, price, image_url, image_urls, trade_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8::jsonb, 'SALE')
         RETURNING *`,
        [
          post.userId,
          post.franchiseId,
          post.franchiseName,
          post.title,
          post.body,
          post.price,
          post.imageUrl || '',
          JSON.stringify(Array.isArray(post.imageUrls) ? post.imageUrls : [])
        ]
      );
      return toTalkPost(result.rows[0]);
    },

    async listTalkComments(postId) {
      const result = await pool.query(
        `SELECT c.*, users.franchise_name AS user_name
         FROM talk_comments c
         LEFT JOIN users ON users.id = c.user_id
         WHERE c.post_id = $1 AND c.status = 'ACTIVE'
         ORDER BY COALESCE(c.parent_comment_id, c.id) ASC, c.parent_comment_id NULLS FIRST, c.created_at ASC, c.id ASC`,
        [postId]
      );
      return result.rows.map(toTalkComment);
    },

    async createTalkComment({ postId, userId, comment, parentCommentId = null }) {
      const result = await pool.query(
        `INSERT INTO talk_comments (post_id, parent_comment_id, user_id, comment)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [postId, parentCommentId, userId, comment]
      );
      const rows = await pool.query(
        `SELECT c.*, users.franchise_name AS user_name
         FROM talk_comments c
         LEFT JOIN users ON users.id = c.user_id
         WHERE c.id = $1`,
        [result.rows[0].id]
      );
      return toTalkComment(rows.rows[0]);
    },

    async findTalkCommentById(id) {
      const result = await pool.query(
        `SELECT c.*, users.franchise_name AS user_name
         FROM talk_comments c
         LEFT JOIN users ON users.id = c.user_id
         WHERE c.id = $1 AND c.status = 'ACTIVE'`,
        [id]
      );
      return toTalkComment(result.rows[0]);
    },

    async deleteTalkComment(id) {
      await pool.query(
        `UPDATE talk_comments
            SET status = 'DELETED', updated_at = now()
          WHERE id = $1`,
        [id]
      );
    },

    async findOrCreateTalkChat({ postId, sellerUserId, buyerUserId }) {
      const result = await pool.query(
        `INSERT INTO talk_chats (post_id, seller_user_id, buyer_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, buyer_user_id)
         DO UPDATE SET updated_at = now(),
                       seller_left_at = NULL,
                       buyer_left_at = NULL
         RETURNING *`,
        [postId, sellerUserId, buyerUserId]
      );
      return toTalkChat(result.rows[0]);
    },

    async findTalkChatForUser(chatId, userId) {
      const result = await pool.query(
        `SELECT c.*, p.title AS post_title, p.franchise_name,
                seller.franchise_name AS seller_name,
                buyer.franchise_name AS buyer_name
         FROM talk_chats c
         JOIN talk_posts p ON p.id = c.post_id
         LEFT JOIN users seller ON seller.id = c.seller_user_id
         LEFT JOIN users buyer ON buyer.id = c.buyer_user_id
         WHERE c.id = $1
           AND (
             (c.seller_user_id = $2 AND c.seller_left_at IS NULL)
             OR (c.buyer_user_id = $2 AND c.buyer_left_at IS NULL)
           )`,
        [chatId, userId]
      );
      return toTalkChat(result.rows[0]);
    },

    async listTalkChatsByUser(userId) {
      const result = await pool.query(
        `SELECT c.*, p.title AS post_title, p.franchise_name,
                seller.franchise_name AS seller_name,
                buyer.franchise_name AS buyer_name,
                lm.message AS last_message,
                lm.created_at AS last_message_at,
                COALESCE(unread.unread_count, 0) AS unread_count
         FROM talk_chats c
         JOIN talk_posts p ON p.id = c.post_id
         LEFT JOIN users seller ON seller.id = c.seller_user_id
         LEFT JOIN users buyer ON buyer.id = c.buyer_user_id
         LEFT JOIN LATERAL (
           SELECT message, created_at
           FROM talk_messages
           WHERE chat_id = c.id
           ORDER BY created_at DESC, id DESC
           LIMIT 1
          ) lm ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS unread_count
            FROM talk_messages
            WHERE chat_id = c.id
              AND sender_user_id IS DISTINCT FROM $1
              AND read_at IS NULL
          ) unread ON true
          WHERE (c.seller_user_id = $1 AND c.seller_left_at IS NULL)
             OR (c.buyer_user_id = $1 AND c.buyer_left_at IS NULL)
          ORDER BY COALESCE(lm.created_at, c.updated_at) DESC`,
        [userId]
      );
      return result.rows.map(toTalkChat);
    },

    async leaveTalkChatForUser(chatId, userId) {
      const result = await pool.query(
        `UPDATE talk_chats
         SET seller_left_at = CASE WHEN seller_user_id = $2 THEN now() ELSE seller_left_at END,
             buyer_left_at = CASE WHEN buyer_user_id = $2 THEN now() ELSE buyer_left_at END,
             updated_at = now()
         WHERE id = $1
           AND (seller_user_id = $2 OR buyer_user_id = $2)
         RETURNING *`,
        [chatId, userId]
      );
      return toTalkChat(result.rows[0]);
    },

    async listTalkMessages(chatId) {
      const result = await pool.query(
        `SELECT m.*, users.franchise_name AS sender_name
         FROM talk_messages m
         LEFT JOIN users ON users.id = m.sender_user_id
         WHERE m.chat_id = $1
         ORDER BY m.created_at ASC, m.id ASC`,
        [chatId]
      );
      return result.rows.map(toTalkMessage);
    },

    async markTalkMessagesRead(chatId, readerUserId) {
      const result = await pool.query(
        `UPDATE talk_messages
         SET read_at = now()
         WHERE chat_id = $1
           AND sender_user_id IS DISTINCT FROM $2
           AND read_at IS NULL
         RETURNING *`,
        [chatId, readerUserId]
      );
      return result.rows.map(toTalkMessage);
    },

    async createTalkMessage({ chatId, senderUserId, message }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO talk_messages (chat_id, sender_user_id, message)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [chatId, senderUserId, message]
        );
        await client.query(
          `UPDATE talk_chats
           SET updated_at = now(),
               seller_left_at = CASE WHEN buyer_user_id = $2 THEN NULL ELSE seller_left_at END,
               buyer_left_at = CASE WHEN seller_user_id = $2 THEN NULL ELSE buyer_left_at END
           WHERE id = $1`,
          [chatId, senderUserId]
        );
        await client.query('COMMIT');
        return toTalkMessage(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async findUserByEmail(email) {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      return toUser(result.rows[0]);
    },

    async findUserByLoginId(loginId) {
      const result = await pool.query(
        'SELECT * FROM users WHERE login_id = $1 OR email = $1 ORDER BY CASE WHEN login_id = $1 THEN 0 ELSE 1 END LIMIT 1',
        [loginId]
      );
      return toUser(result.rows[0]);
    },

    async findUsersByPhone(phone) {
      const clean = String(phone || '').replace(/[^0-9]/g, '');
      if (!clean) return [];
      const result = await pool.query(
        `SELECT *
         FROM users
         WHERE regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = $1
           AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
         ORDER BY created_at DESC, id DESC`,
        [clean]
      );
      return result.rows.map(toUser);
    },

    async findUserById(id) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return toUser(result.rows[0]);
    },

    async findAgencyAuthById(id) {
      const result = await pool.query(
        `SELECT id, type, level, parent_id, name, address, login_id, owner, phone, fee_rate, password_hash, join_code
         FROM agencies
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      return toAgencyAuth(result.rows[0]);
    },

    async findAgencyAuthByLoginId(loginId) {
      const normalized = String(loginId || '').trim();
      if (!normalized) return null;
      const result = await pool.query(
        `SELECT id, type, level, parent_id, name, address, login_id, owner, phone, fee_rate, password_hash, join_code
         FROM agencies
         WHERE login_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [normalized]
      );
      return toAgencyAuth(result.rows[0]);
    },

    async findUserByFranchiseId(franchiseId) {
      const result = await pool.query('SELECT * FROM users WHERE franchise_id = $1', [franchiseId]);
      return toUser(result.rows[0]);
    },

    async findUserByBusinessNumber(businessNumber) {
      const clean = businessNumber.replace(/[^0-9]/g, '');
      const result = await pool.query(
        "SELECT * FROM users WHERE regexp_replace(coalesce(business_number, ''), '[^0-9]', '', 'g') = $1",
        [clean]
      );
      return toUser(result.rows[0]);
    },

    async createNotification(notification) {
      const result = await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING *`,
        [
          notification.userId,
          notification.type,
          notification.title,
          notification.body,
          JSON.stringify(notification.data || {})
        ]
      );
      return toNotification(result.rows[0]);
    },

    async createAuditLog(log) {
      const result = await pool.query(
        `INSERT INTO audit_logs (
          actor_user_id, actor_role, actor_login_id, actor_name,
          action, entity_type, entity_id, entity_name,
          before_data, changed_fields, after_data,
          request_method, request_path, ip_address, user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::text[], $11::jsonb, $12, $13, $14, $15)
        RETURNING *`,
        [
          log.actorUserId || null,
          log.actorRole || '',
          log.actorLoginId || '',
          log.actorName || '',
          log.action,
          log.entityType,
          String(log.entityId || ''),
          log.entityName || '',
          JSON.stringify(log.beforeData || {}),
          Array.isArray(log.changedFields) ? log.changedFields.map(String) : [],
          JSON.stringify(log.afterData || {}),
          log.requestMethod || '',
          log.requestPath || '',
          log.ipAddress || '',
          log.userAgent || ''
        ]
      );
      return toAuditLog(result.rows[0]);
    },

    async listAuditLogs(filters = {}) {
      const clauses = [];
      const params = [];
      if (filters.entityType) {
        params.push(String(filters.entityType));
        clauses.push(`entity_type = $${params.length}`);
      }
      if (filters.entityId) {
        params.push(String(filters.entityId));
        clauses.push(`entity_id = $${params.length}`);
      }
      if (filters.action) {
        params.push(String(filters.action));
        clauses.push(`action = $${params.length}`);
      }
      const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
      params.push(limit);
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = await pool.query(
        `SELECT *
         FROM audit_logs
         ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length}`,
        params
      );
      return result.rows.map(toAuditLog);
    },

    async listUnreadNotifications(userId) {
      const result = await pool.query(
        `SELECT * FROM notifications
         WHERE user_id = $1 AND read_at IS NULL
         ORDER BY created_at ASC`,
        [userId]
      );
      return result.rows.map(toNotification);
    },

    async countUnreadNotifications(userId) {
      const result = await pool.query(
        `SELECT count(*)::int AS count
         FROM notifications
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
      );
      return Number(result.rows[0]?.count || 0);
    },

    async markNotificationsRead(userId, ids) {
      const cleanIds = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
      if (!cleanIds.length) return [];
      const result = await pool.query(
        `UPDATE notifications
         SET read_at = now()
         WHERE user_id = $1 AND id = ANY($2::bigint[])
         RETURNING *`,
        [userId, cleanIds]
      );
      return result.rows.map(toNotification);
    },

    async upsertPushToken(userId, token, platform) {
      const result = await pool.query(
        `INSERT INTO push_tokens (user_id, token, platform, enabled)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (token) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             platform = EXCLUDED.platform,
             enabled = true,
             updated_at = now()
         RETURNING *`,
        [userId, token, platform || null]
      );
      return result.rows[0];
    },

    async upsertWebPushSubscription(userId, subscription, platform) {
      const endpoint = String(subscription?.endpoint || '').trim();
      if (!endpoint) return null;
      const result = await pool.query(
        `INSERT INTO push_tokens (user_id, token, platform, enabled)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (token) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             platform = EXCLUDED.platform,
             enabled = true,
             updated_at = now()
         RETURNING *`,
        [userId, JSON.stringify(subscription), platform || 'web']
      );
      return result.rows[0];
    },

    async listPushTokens(filters = {}) {
      const params = [];
      const where = [];
      if (filters.userId) {
        params.push(filters.userId);
        where.push(`pt.user_id = $${params.length}`);
      }
      if (filters.email) {
        params.push(filters.email);
        where.push(`(users.email = $${params.length} OR users.login_id = $${params.length} OR users.contact_email = $${params.length})`);
      }
      const sql = `
        SELECT pt.*, users.email, users.login_id, users.name, users.franchise_name
        FROM push_tokens pt
        LEFT JOIN users ON users.id = pt.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY pt.updated_at DESC, pt.id DESC
        LIMIT 500`;
      const result = await pool.query(sql, params);
      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        email: row.login_id || row.email,
        name: row.franchise_name || row.name || '',
        token: row.token,
        platform: row.platform || 'unknown',
        enabled: row.enabled !== false,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },

    async countPushTokenSummary(filters = {}) {
      const tokens = await this.listPushTokens(filters);
      const users = new Set(tokens.map(token => String(token.userId)).filter(Boolean)).size;
      const webTokens = tokens.filter(token => token.platform === 'web');
      return {
        tokens: {
          total: tokens.length,
          enabled: tokens.filter(token => token.enabled).length,
          disabled: tokens.filter(token => !token.enabled).length,
          users
        },
        webSubscriptions: {
          total: webTokens.length,
          enabled: webTokens.filter(token => token.enabled).length,
          users: new Set(webTokens.map(token => String(token.userId)).filter(Boolean)).size
        },
        rows: tokens
      };
    },

    async createUser(user) {
      const result = await pool.query(
        `INSERT INTO users (
          email, password_hash, name, franchise_name, role, balance,
          phone, address, tel, business_number, agency_id, biz_doc_file_key, pos_file_key, franchise_fee_rate,
          signup_source, signup_agency_id, signup_join_code
        )
        VALUES ($1, $2, $3, $4, 'OWNER', 0, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          user.email,
          user.passwordHash,
          user.name,
          user.franchiseName,
          user.phone || null,
          user.address || null,
          user.tel || null,
          user.businessNumber,
          user.agencyId || null,
          user.bizDocFileKey || null,
          user.posFileKey || null,
          user.franchiseFeeRate == null || user.franchiseFeeRate === '' ? 0 : Number(user.franchiseFeeRate),
          user.signupSource || null,
          user.signupAgencyId || null,
          user.signupJoinCode || null
        ]
      );
      if (user.loginId || user.contactEmail) {
        const updated = await pool.query(
          `UPDATE users
           SET login_id = COALESCE($2, login_id),
               contact_email = COALESCE($3, contact_email),
               updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [result.rows[0].id, user.loginId || null, user.contactEmail || null]
        );
        return toUser(updated.rows[0]);
      }
      return toUser(result.rows[0]);
    },

    async upsertAdminUser(user) {
      const result = await pool.query(
        `INSERT INTO users (
           email, password_hash, name, role, balance,
           franchise_name, phone, address, tel, business_number,
           admin_level, admin_permissions, admin_active,
           customer_id, agency_id, biz_doc_file_key
         )
         VALUES ($1, $2, $3, 'ADMIN', 0, $3, NULL, NULL, NULL, NULL, $4, $5::jsonb, true, NULL, NULL, NULL)
         ON CONFLICT (email)
         DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = 'ADMIN',
           admin_level = COALESCE(users.admin_level, EXCLUDED.admin_level),
           admin_permissions = COALESCE(users.admin_permissions, EXCLUDED.admin_permissions),
           admin_active = true,
           franchise_name = EXCLUDED.name,
           phone = NULL,
           address = NULL,
           tel = NULL,
           business_number = NULL,
           customer_id = NULL,
           agency_id = NULL,
           biz_doc_file_key = NULL,
           updated_at = now()
         RETURNING *`,
        [user.email, user.passwordHash, user.name, user.adminLevel || 'SUPER', JSON.stringify(user.adminPermissions || null)]
      );
      const updated = await pool.query(
        'UPDATE users SET franchise_id = id, franchise_name = name, updated_at = now() WHERE id = $1 RETURNING *',
        [result.rows[0].id]
      );
      return toUser(updated.rows[0]);
    },

    async listAdminUsers() {
      const result = await pool.query(
        `SELECT *
         FROM users
         WHERE role = 'ADMIN'
           AND COALESCE(admin_active, true) = true
         ORDER BY
           CASE COALESCE(admin_level, 'SUPER')
             WHEN 'SUPER' THEN 1
             WHEN 'OPERATIONS' THEN 2
             WHEN 'SETTLEMENT' THEN 3
             WHEN 'CUSTOMER' THEN 4
             ELSE 9
           END,
           created_at ASC`
      );
      return result.rows.map(toUser);
    },

    async createAdminUser(user) {
      const result = await pool.query(
        `INSERT INTO users (
           email, login_id, password_hash, name, role, balance,
           franchise_name, admin_level, admin_permissions, admin_active,
           phone, address, tel, business_number, customer_id, agency_id, biz_doc_file_key, pos_file_key
         )
         VALUES ($1, $1, $2, $3, 'ADMIN', 0, $3, $4, $5::jsonb, true, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
         ON CONFLICT (email)
         DO UPDATE SET
           login_id = EXCLUDED.login_id,
           password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = 'ADMIN',
           franchise_name = EXCLUDED.franchise_name,
           admin_level = EXCLUDED.admin_level,
           admin_permissions = EXCLUDED.admin_permissions,
           admin_active = true,
           phone = NULL,
           address = NULL,
           tel = NULL,
           business_number = NULL,
           customer_id = NULL,
           agency_id = NULL,
           biz_doc_file_key = NULL,
           pos_file_key = NULL,
           updated_at = now()
         RETURNING *`,
        [user.loginId, user.passwordHash, user.name, user.adminLevel || 'CUSTOMER', JSON.stringify(user.adminPermissions || [])]
      );
      const updated = await pool.query(
        'UPDATE users SET franchise_id = id, updated_at = now() WHERE id = $1 RETURNING *',
        [result.rows[0].id]
      );
      return toUser(updated.rows[0]);
    },

    async updateAdminUser(id, fields) {
      const updates = [];
      const params = [id];
      if (fields.loginId !== undefined) {
        params.push(fields.loginId);
        updates.push(`email = $${params.length}`, `login_id = $${params.length}`);
      }
      if (fields.name !== undefined) {
        params.push(fields.name);
        updates.push(`name = $${params.length}`, `franchise_name = $${params.length}`);
      }
      if (fields.adminLevel !== undefined) {
        params.push(fields.adminLevel);
        updates.push(`admin_level = $${params.length}`);
      }
      if (fields.adminPermissions !== undefined) {
        params.push(JSON.stringify(fields.adminPermissions || []));
        updates.push(`admin_permissions = $${params.length}::jsonb`);
      }
      if (fields.passwordHash !== undefined) {
        params.push(fields.passwordHash);
        updates.push(`password_hash = $${params.length}`);
      }
      if (fields.adminActive !== undefined) {
        params.push(fields.adminActive);
        updates.push(`admin_active = $${params.length}`);
      }
      if (!updates.length) return this.findUserById(id);
      const result = await pool.query(
        `UPDATE users
         SET ${updates.join(', ')},
             role = 'ADMIN',
             updated_at = now()
         WHERE id = $1
           AND role = 'ADMIN'
         RETURNING *`,
        params
      );
      return toUser(result.rows[0]);
    },

    async markAdminLogin(userId) {
      const result = await pool.query(
        'UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1 AND role = $2 RETURNING *',
        [userId, 'ADMIN']
      );
      return toUser(result.rows[0]);
    },

    async countActiveSuperAdmins(exceptId = null) {
      const result = await pool.query(
        `SELECT count(*)::int AS count
         FROM users
         WHERE role = 'ADMIN'
           AND COALESCE(admin_active, true) = true
           AND COALESCE(admin_level, 'SUPER') = 'SUPER'
           AND ($1::bigint IS NULL OR id <> $1::bigint)`,
        [exceptId]
      );
      return result.rows[0]?.count || 0;
    },

    async listFranchiseUsers() {
      const result = await pool.query(
        `SELECT users.*, agencies.name AS agency_name, biz_doc_file.original_name AS biz_doc_original_name
         FROM users
         LEFT JOIN agencies ON agencies.id = users.agency_id
         LEFT JOIN stored_files biz_doc_file ON biz_doc_file.file_key = users.biz_doc_file_key
         WHERE users.role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
         ORDER BY users.created_at DESC`
      );
      return result.rows.map(toUser);
    },

    async listAgencies() {
      const result = await pool.query(
        `SELECT agencies.id, agencies.type, agencies.level, agencies.parent_id, agencies.name, agencies.address,
                agencies.login_id, agencies.owner, agencies.phone, agencies.fee_rate, agencies.delivery_note,
                agencies.join_code, agencies.contract_file_key, contract_file.original_name AS contract_file_name,
                agencies.settle_bank_name, agencies.settle_account_no, agencies.settle_account_holder, agencies.created_at
         FROM agencies
         LEFT JOIN stored_files contract_file ON contract_file.file_key = agencies.contract_file_key
         ORDER BY agencies.created_at DESC`
      );
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        level: Number(row.level || (row.type === 'HQ' ? 1 : 3)),
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        region: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        deliveryNote: row.delivery_note || '',
        joinCode: row.join_code,
        contractFileKey: row.contract_file_key,
        contractFileName: row.contract_file_name,
        settleBankName: row.settle_bank_name,
        settleAccountNo: row.settle_account_no,
        settleAccountHolder: row.settle_account_holder,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      }));
    },

    async ensureDefaultAgency() {
      const result = await pool.query(
        `WITH existing AS (
           SELECT *
           FROM agencies
           WHERE join_code = $1 OR (type = 'HQ' AND name IN ($2, $3))
           ORDER BY CASE WHEN join_code = $1 THEN 0 WHEN name = $2 THEN 1 ELSE 2 END
           LIMIT 1
         ),
         inserted AS (
           INSERT INTO agencies (type, level, parent_id, name, address, login_id, owner, phone, fee_rate, delivery_note, join_code)
           SELECT 'HQ', 1, NULL, $2, '', 'eatspay-hq', 'Eats Pay Admin', '', 0, '', $1
           WHERE NOT EXISTS (SELECT 1 FROM existing)
           RETURNING *
         )
         SELECT * FROM existing
         UNION ALL
         SELECT * FROM inserted
         LIMIT 1`,
        ['EATSPAY-HQ', '이츠페이 본사', '본사']
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        type: row.type,
        level: Number(row.level || 1),
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        region: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        deliveryNote: row.delivery_note || '',
        joinCode: row.join_code
      };
    },

    async findAgencyByJoinCode(joinCode) {
      const code = String(joinCode || '').trim();
      if (!code) return null;
      const result = await pool.query(
        `SELECT id, type, level, parent_id, name, address, login_id, owner, phone, fee_rate, delivery_note, join_code
         FROM agencies
         WHERE lower(join_code) = lower($1)
         LIMIT 1`,
        [code]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        type: row.type,
        level: Number(row.level || 3),
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        region: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        deliveryNote: row.delivery_note || '',
        joinCode: row.join_code
      };
    },

    async updateUserRoleByEmail(email, role) {
      const result = await pool.query(
        'UPDATE users SET role = $2, updated_at = now() WHERE login_id = $1 OR email = $1 RETURNING *',
        [email, role]
      );
      return toUser(result.rows[0]);
    },

    async updateFranchiseAgency(franchiseId, agencyId) {
      const result = await pool.query(
        `UPDATE users
         SET agency_id = $2, updated_at = now()
         WHERE franchise_id = $1
           AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
         RETURNING *`,
        [franchiseId, agencyId]
      );
      return toUser(result.rows[0]);
    },

    async updateFranchisesAgency(franchiseIds, agencyId) {
      const ids = franchiseIds.map(id => Number(id)).filter(Number.isFinite);
      if (!ids.length) return [];
      const result = await pool.query(
        `UPDATE users
         SET agency_id = $2, updated_at = now()
         WHERE franchise_id = ANY($1::bigint[])
           AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
         RETURNING *`,
        [ids, agencyId]
      );
      return result.rows.map(toUser);
    },

    async updateFranchiseDetails(franchiseId, fields) {
      const result = await pool.query(
        `UPDATE users
         SET franchise_name = $2,
             name = $3,
             phone = $4,
             business_number = NULLIF($5, ''),
             tel = COALESCE($6, tel),
             address = COALESCE($7, address),
             login_id = COALESCE(NULLIF($8, ''), login_id),
             contact_email = COALESCE(NULLIF($9, ''), contact_email),
             agency_id = COALESCE($10, agency_id),
             franchise_fee_rate = $11,
             updated_at = now()
         WHERE franchise_id = $1
           AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
         RETURNING *`,
        [
          franchiseId,
          fields.franchiseName,
          fields.ownerName,
          fields.phone,
          fields.businessNumber,
          fields.tel || null,
          fields.address || null,
          fields.loginId || null,
          fields.contactEmail || null,
          fields.agencyId || null,
          fields.franchiseFeeRate == null || fields.franchiseFeeRate === '' ? 0 : Number(fields.franchiseFeeRate)
        ]
      );
      return toUser(result.rows[0]);
    },

    async replaceDeliveryAccountsForFranchise(franchiseId, accounts = []) {
      const normalizedAccounts = dedupeDeliveryAccountInput(accounts);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existingResult = await client.query(
          `SELECT da.*, sf.original_name
           FROM delivery_accounts da
           LEFT JOIN stored_files sf ON sf.file_key = da.file_key
           WHERE da.franchise_id = $1`,
          [franchiseId]
        );
        const existingAccounts = existingResult.rows.map(toDeliveryAccount).filter(Boolean);
        const existingById = new Map(existingAccounts.map(account => [String(account.id), account]));
        const existingByKey = new Map(existingAccounts.map(account => [deliveryAccountDedupeKey(account), account]));
        const incomingIds = new Set(normalizedAccounts.map(account => String(account.id || '')).filter(Boolean));
        const incomingKeys = new Set(normalizedAccounts.map(deliveryAccountDedupeKey));
        const accountsToSave = [...normalizedAccounts];
        for (const previous of existingAccounts) {
          if (previous.accountStatus !== 'APPROVED' || !String(previous.txid || '').trim()) continue;
          if (incomingIds.has(String(previous.id)) || incomingKeys.has(deliveryAccountDedupeKey(previous))) continue;
          accountsToSave.push(previous);
        }
        await client.query('DELETE FROM delivery_accounts WHERE franchise_id = $1', [franchiseId]);
        const rows = [];
        for (const account of accountsToSave) {
          const previous = existingById.get(String(account.id || '')) || existingByKey.get(deliveryAccountDedupeKey(account)) || null;
          const previousTxid = String(previous?.txid || '').trim();
          const nextTxid = String(account.txid || previousTxid || '').trim();
          let nextStatus = account.accountStatus || previous?.accountStatus || 'PENDING';
          if (previous?.accountStatus === 'APPROVED' && previousTxid && nextStatus !== 'REJECTED') {
            nextStatus = 'APPROVED';
          }
          const result = await client.query(
            `INSERT INTO delivery_accounts (
              franchise_id, agency_id, agency_name, bank_name, account_holder, account_no, file_key,
              account_status, rejection_reason, approved_at, export_ready_at, exported_at, txid, txid_uploaded_at, active, hidden
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *,
              (SELECT original_name FROM stored_files WHERE file_key = $7) AS original_name`,
            [
              franchiseId,
              account.agencyId || null,
              account.agencyName,
              account.bankName,
              account.accountHolder,
              account.accountNo,
              account.fileKey || null,
              nextStatus,
              previous?.rejectionReason || null,
              previous?.approvedAt || null,
              previous?.exportReadyAt || null,
              previous?.exportedAt || null,
              nextTxid || null,
              previous?.txidUploadedAt || null,
              account.active !== false,
              account.hidden === true || previous?.hidden === true
            ]
          );
          rows.push(toDeliveryAccount(result.rows[0]));
        }
        await client.query('COMMIT');
        return rows;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async dedupeDeliveryAccountsForFranchise(franchiseId) {
      const result = await pool.query(
        `DELETE FROM delivery_accounts da
         USING (
           SELECT id,
                  row_number() OVER (
                    PARTITION BY franchise_id,
                                 COALESCE(agency_id::text, ''),
                                 lower(trim(COALESCE(agency_name, ''))),
                                 lower(trim(COALESCE(bank_name, ''))),
                                 regexp_replace(COALESCE(account_no, ''), '[^0-9A-Za-z]', '', 'g'),
                                 lower(trim(COALESCE(account_holder, '')))
                    ORDER BY
                      CASE account_status
                        WHEN 'APPROVED' THEN 0
                        WHEN '승인완료' THEN 0
                        WHEN 'PENDING' THEN 1
                        WHEN '승인대기' THEN 1
                        ELSE 2
                      END,
                      id DESC
                  ) AS rn
           FROM delivery_accounts
           WHERE franchise_id = $1
         ) d
         WHERE da.id = d.id
           AND d.rn > 1
         RETURNING da.*`,
        [franchiseId]
      );
      return result.rows.map(toDeliveryAccount);
    },

    async deleteFranchiseById(franchiseId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txCountResult = await client.query(
          'SELECT count(*)::int AS count FROM transactions WHERE franchise_id = $1',
          [franchiseId]
        );
        if (Number(txCountResult.rows[0]?.count || 0) > 0) {
          const err = new Error('Transactions exist for this franchise.');
          err.code = 'FRANCHISE_HAS_TRANSACTIONS';
          throw err;
        }
        await client.query('DELETE FROM account_requests WHERE franchise_id = $1', [franchiseId]);
        await client.query('DELETE FROM delivery_accounts WHERE franchise_id = $1', [franchiseId]);
        const userResult = await client.query(
          `DELETE FROM users
           WHERE franchise_id = $1
             AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
           RETURNING *`,
          [franchiseId]
        );
        const user = userResult.rows[0];
        if (!user) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query('COMMIT');
        return toUser(user);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async updateUserPasswordByFranchiseId(franchiseId, passwordHash) {
      const result = await pool.query(
        'UPDATE users SET password_hash = $2, updated_at = now() WHERE franchise_id = $1 RETURNING *',
        [franchiseId, passwordHash]
      );
      return toUser(result.rows[0]);
    },

    async updateUserPasswordById(userId, passwordHash) {
      const result = await pool.query(
        'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [userId, passwordHash]
      );
      return toUser(result.rows[0]);
    },

    async updateUserProfile(userId, fields) {
      const updates = [];
      const params = [userId];
      if (fields.phone !== undefined) {
        params.push(fields.phone);
        updates.push(`phone = $${params.length}`);
      }
      if (fields.passwordHash !== undefined) {
        params.push(fields.passwordHash);
        updates.push(`password_hash = $${params.length}`);
      }
      if (!updates.length) {
        return this.findUserById(userId);
      }
      const result = await pool.query(
        `UPDATE users
         SET ${updates.join(', ')}, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        params
      );
      return toUser(result.rows[0]);
    },

    async updateFranchiseBizDoc(franchiseId, fileKey) {
      const result = await pool.query(
        'UPDATE users SET biz_doc_file_key = $2, updated_at = now() WHERE franchise_id = $1 RETURNING *',
        [franchiseId, fileKey]
      );
      return toUser(result.rows[0]);
    },

    async updateAgencyPasswordById(agencyId, passwordHash) {
      const result = await pool.query(
        'UPDATE agencies SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id, name',
        [agencyId, passwordHash]
      );
      return result.rows[0] || null;
    },

    async updateAgencyContractFile(agencyId, fileKey) {
      const result = await pool.query(
        'UPDATE agencies SET contract_file_key = $2, updated_at = now() WHERE id = $1 RETURNING id, name, contract_file_key',
        [agencyId, fileKey]
      );
      return result.rows[0] || null;
    },

    async updateAgencySettleAccount(agencyId, data) {
      const result = await pool.query(
        `UPDATE agencies
         SET settle_bank_name = $2,
             settle_account_no = $3,
             settle_account_holder = $4,
             settle_doc_file_key = coalesce($5, settle_doc_file_key),
             updated_at = now()
         WHERE id = $1
         RETURNING id, name, settle_bank_name, settle_account_no, settle_account_holder, settle_doc_file_key`,
        [agencyId, data.bankName, data.accountNo, data.accountHolder, data.fileKey || null]
      );
      return result.rows[0] || null;
    },

    async createAgency(agency) {
      const result = await pool.query(
        `INSERT INTO agencies (
           type, level, parent_id, name, address, login_id, owner, phone, fee_rate, delivery_note, join_code
         )
         VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9, $10, $11)
         RETURNING id, type, level, parent_id, name, address, login_id, owner, phone, fee_rate, delivery_note, join_code,
                   contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at`,
        [
          agency.type || 'AGENCY',
          agency.level || 3,
          agency.parentId || null,
          agency.name,
          agency.address || null,
          agency.loginId || null,
          agency.owner || null,
          agency.phone || null,
          agency.feeRate || 0,
          agency.deliveryNote || '',
          agency.joinCode || null
        ]
      );
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        level: Number(row.level || 3),
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        region: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        deliveryNote: row.delivery_note || '',
        joinCode: row.join_code,
        contractFileKey: row.contract_file_key,
        settleBankName: row.settle_bank_name,
        settleAccountNo: row.settle_account_no,
        settleAccountHolder: row.settle_account_holder,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      }))[0] || null;
    },

    async updateAgency(agencyId, agency) {
      const result = await pool.query(
        `UPDATE agencies
         SET type = $2,
             level = $3,
             parent_id = $4,
             name = $5,
             address = $6,
             login_id = NULLIF($7, ''),
             owner = $8,
             phone = $9,
             fee_rate = $10,
             delivery_note = $11,
             updated_at = now()
         WHERE id = $1
         RETURNING id, type, level, parent_id, name, address, login_id, owner, phone, fee_rate, delivery_note, join_code,
                   contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at`,
        [
          agencyId,
          agency.type || 'AGENCY',
          agency.level || 3,
          agency.parentId || null,
          agency.name,
          agency.address || null,
          agency.loginId || null,
          agency.owner || null,
          agency.phone || null,
          agency.feeRate || 0,
          agency.deliveryNote || ''
        ]
      );
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        level: Number(row.level || 3),
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        region: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        deliveryNote: row.delivery_note || '',
        joinCode: row.join_code,
        contractFileKey: row.contract_file_key,
        settleBankName: row.settle_bank_name,
        settleAccountNo: row.settle_account_no,
        settleAccountHolder: row.settle_account_holder,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      }))[0] || null;
    },

    async updateAgencyJoinCode(agencyId, joinCode) {
      const result = await pool.query(
        `UPDATE agencies
         SET join_code = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING id, type, level, parent_id, name, address, login_id, owner, phone, fee_rate, delivery_note, join_code,
                   contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at`,
        [agencyId, joinCode]
      );
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        level: Number(row.level || 3),
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        region: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        deliveryNote: row.delivery_note || '',
        joinCode: row.join_code,
        contractFileKey: row.contract_file_key,
        settleBankName: row.settle_bank_name,
        settleAccountNo: row.settle_account_no,
        settleAccountHolder: row.settle_account_holder,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      }))[0] || null;
    },

    async countUsersByAgencyId(agencyId) {
      const result = await pool.query(
        "SELECT count(*)::int AS count FROM users WHERE agency_id = $1 AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')",
        [agencyId]
      );
      return Number(result.rows[0]?.count || 0);
    },

    async deleteAgency(agencyId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE agencies SET parent_id = NULL WHERE parent_id = $1', [agencyId]);
        await client.query("UPDATE users SET agency_id = NULL, updated_at = now() WHERE agency_id = $1 AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')", [agencyId]);
        await client.query('UPDATE delivery_accounts SET agency_id = NULL WHERE agency_id = $1', [agencyId]);
        await client.query('UPDATE transactions SET agency_id = NULL WHERE agency_id = $1', [agencyId]);
        const result = await client.query(
          'DELETE FROM agencies WHERE id = $1 RETURNING id, name',
          [agencyId]
        );
        await client.query('COMMIT');
        return result.rows[0] || null;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async registerCard(userId, card) {
      const result = await pool.query(
        `INSERT INTO cards (id, user_id, masked_number, card_name, card_company, alias, active, expiry_month, expiry_year, payer_name, payer_email, payer_tel, card_identity)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $11, $12)
         RETURNING id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, payer_name, payer_email, payer_tel, card_identity, created_at`,
        [
          card.id,
          userId,
          card.maskedNumber,
          card.cardName,
          card.cardCompany || null,
          card.alias,
          card.expiryMonth || null,
          card.expiryYear || null,
          card.payerName || null,
          card.payerEmail || null,
          card.payerTel || null,
          card.cardIdentity || null
        ]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        active: row.active,
        hidden: row.hidden === true,
        expiryMonth: row.expiry_month,
        expiryYear: row.expiry_year,
        payerName: row.payer_name,
        payerEmail: row.payer_email,
        payerTel: row.payer_tel,
        cardIdentity: row.card_identity,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      };
    },

    async countCardsByUserId(userId) {
      const result = await pool.query('SELECT count(*)::int AS count FROM cards WHERE user_id = $1', [userId]);
      return result.rows[0]?.count || 0;
    },

    async listCardsByUserId(userId) {
      const result = await pool.query(
        'SELECT id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, payer_name, payer_email, payer_tel, card_identity, created_at FROM cards WHERE user_id = $1 ORDER BY COALESCE(hidden, false) ASC, COALESCE(active, true) DESC, created_at DESC',
        [userId]
      );
      return result.rows.map(row => ({
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        active: row.active !== false,
        hidden: row.hidden === true,
        expiryMonth: row.expiry_month,
        expiryYear: row.expiry_year,
        payerName: row.payer_name,
        payerEmail: row.payer_email,
        payerTel: row.payer_tel,
        cardIdentity: row.card_identity,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      }));
    },

    async findCardByUserId(cardId, userId) {
      const result = await pool.query(
        'SELECT id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, payer_name, payer_email, payer_tel, card_identity, created_at FROM cards WHERE id = $1 AND user_id = $2',
        [cardId, userId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        active: row.active !== false,
        hidden: row.hidden === true,
        expiryMonth: row.expiry_month,
        expiryYear: row.expiry_year,
        payerName: row.payer_name,
        payerEmail: row.payer_email,
        payerTel: row.payer_tel,
        cardIdentity: row.card_identity,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      };
    },

    async updateCardByUserId(cardId, userId, data) {
      const result = await pool.query(
        `UPDATE cards
         SET masked_number = COALESCE($3, masked_number),
             card_name = COALESCE($4, card_name),
             card_company = COALESCE($5, card_company),
             alias = COALESCE($6, alias)
         WHERE id = $1 AND user_id = $2
         RETURNING id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, payer_name, payer_email, payer_tel, card_identity, created_at`,
        [
          cardId,
          userId,
          data.maskedNumber || null,
          data.cardName || null,
          data.cardCompany || null,
          data.alias || null
        ]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        active: row.active !== false,
        hidden: row.hidden === true,
        expiryMonth: row.expiry_month,
        expiryYear: row.expiry_year,
        payerName: row.payer_name,
        payerEmail: row.payer_email,
        payerTel: row.payer_tel,
        cardIdentity: row.card_identity,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      };
    },

    async updateCardActiveByUserId(cardId, userId, active) {
      const result = await pool.query(
        `UPDATE cards
         SET active = $3
         WHERE id = $1 AND user_id = $2
         RETURNING id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, payer_name, payer_email, payer_tel, card_identity, created_at`,
        [cardId, userId, Boolean(active)]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        active: row.active !== false,
        hidden: row.hidden === true,
        expiryMonth: row.expiry_month,
        expiryYear: row.expiry_year,
        payerName: row.payer_name,
        payerEmail: row.payer_email,
        payerTel: row.payer_tel,
        cardIdentity: row.card_identity,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      };
    },

    async updateCardHiddenByUserId(cardId, userId, hidden) {
      const result = await pool.query(
        `UPDATE cards
         SET hidden = $3
         WHERE id = $1 AND user_id = $2
         RETURNING id, masked_number, card_name, card_company, alias, active, hidden, expiry_month, expiry_year, payer_name, payer_email, payer_tel, card_identity, created_at`,
        [cardId, userId, Boolean(hidden)]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        active: row.active !== false,
        hidden: row.hidden === true,
        expiryMonth: row.expiry_month,
        expiryYear: row.expiry_year,
        payerName: row.payer_name,
        payerEmail: row.payer_email,
        payerTel: row.payer_tel,
        cardIdentity: row.card_identity,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      };
    },

    async deleteCardByUserId(cardId, userId) {
      const result = await pool.query(
        'DELETE FROM cards WHERE id = $1 AND user_id = $2 RETURNING id',
        [cardId, userId]
      );
      return result.rows[0] || null;
    },

    async recordFile(file) {
      const result = await pool.query(
        `INSERT INTO stored_files (
          file_key, original_name, mime_type, size_bytes, storage_path, public_url, uploaded_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          file.fileKey,
          file.originalName,
          file.mimeType,
          file.sizeBytes,
          file.storagePath,
          file.publicUrl || null,
          file.uploadedBy || null
        ]
      );
      return toStoredFile(result.rows[0]);
    },

    async listStoredOriginalNamesByPrefix(prefix) {
      const normalizedPrefix = String(prefix || '').trim();
      if (!normalizedPrefix) return [];
      const result = await pool.query(
        `SELECT original_name
         FROM stored_files
         WHERE original_name LIKE $1
         ORDER BY original_name ASC`,
        [`${normalizedPrefix}%`]
      );
      return result.rows.map(row => row.original_name).filter(Boolean);
    },

    async findFileByKey(fileKey) {
      const result = await pool.query('SELECT * FROM stored_files WHERE file_key = $1', [fileKey]);
      return toStoredFile(result.rows[0]);
    },

    async updateStoredFileOriginalName(fileKey, originalName) {
      const result = await pool.query(
        'UPDATE stored_files SET original_name = $2 WHERE file_key = $1 RETURNING *',
        [fileKey, originalName]
      );
      return toStoredFile(result.rows[0]);
    },

    async deleteFileByKey(fileKey) {
      const result = await pool.query('DELETE FROM stored_files WHERE file_key = $1 RETURNING *', [fileKey]);
      return toStoredFile(result.rows[0]);
    },

    async addDeliveryAccount(account) {
      const result = await pool.query(
        `INSERT INTO delivery_accounts (
          franchise_id, agency_id, agency_name, bank_name, account_holder, account_no, file_key, account_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
        RETURNING *,
          (SELECT original_name FROM stored_files WHERE file_key = $7) AS original_name`,
        [
          account.franchiseId,
          account.agencyId || null,
          account.agencyName,
          account.bankName,
          account.accountHolder,
          account.accountNo,
          account.fileKey || null
        ]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async listDeliveryAccounts(options = {}) {
      const includeHidden = options.includeHidden === true;
      const result = await pool.query(`
        SELECT da.*, sf.original_name
        FROM delivery_accounts da
        LEFT JOIN stored_files sf ON sf.file_key = da.file_key
        ${includeHidden ? '' : 'WHERE COALESCE(da.hidden, false) = false'}
        ORDER BY da.req_date DESC
      `);
      return result.rows.map(toDeliveryAccount);
    },

    async listDeliveryAccountsByFranchise(franchiseId) {
      const result = await pool.query(
        `SELECT da.*, sf.original_name
         FROM delivery_accounts da
         LEFT JOIN stored_files sf ON sf.file_key = da.file_key
         WHERE da.franchise_id = $1
           AND COALESCE(da.hidden, false) = false
         ORDER BY da.req_date DESC`,
        [franchiseId]
      );
      return result.rows.map(toDeliveryAccount);
    },

    async deleteDeliveryAccountByFranchise(id, franchiseId) {
      const result = await pool.query(
        'DELETE FROM delivery_accounts WHERE id = $1 AND franchise_id = $2 RETURNING *',
        [id, franchiseId]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async updateDeliveryAccountVisibilityByFranchise(id, franchiseId, data) {
      const result = await pool.query(
        `UPDATE delivery_accounts
         SET active = COALESCE($3, active),
             hidden = COALESCE($4, hidden),
             updated_at = now()
         WHERE id = $1 AND franchise_id = $2
         RETURNING *`,
        [
          id,
          franchiseId,
          typeof data.active === 'boolean' ? data.active : null,
          typeof data.hidden === 'boolean' ? data.hidden : null
        ]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async updateDeliveryAccountVisibility(id, data) {
      const result = await pool.query(
        `UPDATE delivery_accounts
         SET active = COALESCE($2, active),
             hidden = COALESCE($3, hidden),
             updated_at = now()
         WHERE id = $1
         RETURNING *,
           (SELECT original_name FROM stored_files WHERE file_key = COALESCE($6, delivery_accounts.file_key)) AS original_name`,
        [
          id,
          typeof data.active === 'boolean' ? data.active : null,
          typeof data.hidden === 'boolean' ? data.hidden : null
        ]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async updateDeliveryAccount(id, data) {
      const result = await pool.query(
        `UPDATE delivery_accounts
         SET agency_name = COALESCE($2, agency_name),
             bank_name = COALESCE($3, bank_name),
             account_holder = COALESCE($4, account_holder),
             account_no = COALESCE($5, account_no),
             file_key = COALESCE($6, file_key),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          data.agencyName || null,
          data.bankName || null,
          data.accountHolder || null,
          data.accountNo || null,
          data.fileKey || null
        ]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async findDeliveryAccountById(id) {
      const result = await pool.query(
        `SELECT da.*, sf.original_name
         FROM delivery_accounts da
         LEFT JOIN stored_files sf ON sf.file_key = da.file_key
         WHERE da.id = $1`,
        [id]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async updateDeliveryAccountApprovalStatus(id, data) {
      const result = await pool.query(
        `UPDATE delivery_accounts
         SET account_status = $2,
             rejection_reason = $3,
             approved_at = CASE WHEN $2 = 'APPROVED' THEN COALESCE(approved_at, now()) ELSE approved_at END,
             export_ready_at = CASE WHEN $2 = 'APPROVED' AND export_ready_at IS NULL THEN now() ELSE export_ready_at END,
             updated_at = now()
         WHERE id = $1
         RETURNING *,
           (SELECT original_name FROM stored_files WHERE file_key = delivery_accounts.file_key) AS original_name`,
        [
          id,
          data.status,
          data.rejectionReason || null
        ]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async deleteDeliveryAccount(id) {
      const result = await pool.query(
        'DELETE FROM delivery_accounts WHERE id = $1 RETURNING *',
        [id]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async listDeliveryAgencies() {
      const result = await pool.query(
        `SELECT delivery_agencies.id, delivery_agencies.name, delivery_agencies.status, delivery_agencies.sort_order,
                delivery_agencies.latitude, delivery_agencies.longitude, delivery_agencies.coverage_area,
                delivery_agencies.phone, delivery_agencies.description,
                delivery_agencies.logo_url, delivery_agencies.corporation_name, delivery_agencies.business_number,
                delivery_agencies.business_file_key, business_file.original_name AS business_file_name,
                delivery_agencies.created_at, delivery_agencies.updated_at
         FROM delivery_agencies
         LEFT JOIN stored_files business_file ON business_file.file_key = delivery_agencies.business_file_key
         WHERE delivery_agencies.status <> 'deleted'
         ORDER BY delivery_agencies.sort_order ASC, delivery_agencies.name ASC`
      );
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url || '',
        corporationName: row.corporation_name || '',
        businessNumber: row.business_number || '',
        businessFileKey: row.business_file_key || '',
        businessFileName: row.business_file_name || '',
        status: row.status,
        sortOrder: row.sort_order,
        latitude: row.latitude == null ? null : Number(row.latitude),
        longitude: row.longitude == null ? null : Number(row.longitude),
        coverageArea: row.coverage_area || '',
        phone: row.phone || '',
        description: row.description || '',
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      }));
    },

    async createDeliveryAgency(data, status = 'active', sortOrder = 0) {
      const payload = typeof data === 'object'
        ? data
        : { name: data, status, sortOrder };
      const result = await pool.query(
        `INSERT INTO delivery_agencies (name, status, sort_order, logo_url, corporation_name, business_number)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET
           status = EXCLUDED.status,
           sort_order = EXCLUDED.sort_order,
           logo_url = EXCLUDED.logo_url,
           corporation_name = EXCLUDED.corporation_name,
           business_number = EXCLUDED.business_number,
           updated_at = now()
         RETURNING id, name, status, sort_order, logo_url, corporation_name, business_number, business_file_key, created_at, updated_at`,
        [
          payload.name,
          payload.status || status || 'active',
          Number(payload.sortOrder ?? sortOrder) || 0,
          payload.logoUrl || '',
          payload.corporationName || '',
          payload.businessNumber || ''
        ]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url || '',
        corporationName: row.corporation_name || '',
        businessNumber: row.business_number || '',
        businessFileKey: row.business_file_key || '',
        status: row.status,
        sortOrder: row.sort_order,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      };
    },

    async updateDeliveryAgencyStatus(id, status) {
      const result = await pool.query(
        `UPDATE delivery_agencies
         SET status = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING id, name, status, sort_order, logo_url, corporation_name, business_number, business_file_key, created_at, updated_at`,
        [id, status]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url || '',
        corporationName: row.corporation_name || '',
        businessNumber: row.business_number || '',
        businessFileKey: row.business_file_key || '',
        status: row.status,
        sortOrder: row.sort_order,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      };
    },

    async updateDeliveryAgency(id, data = {}) {
      const result = await pool.query(
        `UPDATE delivery_agencies
         SET name = $2,
             status = $3,
             sort_order = $4,
             logo_url = $5,
             corporation_name = $6,
             business_number = $7,
             updated_at = now()
         WHERE id = $1
         RETURNING id, name, status, sort_order, logo_url, corporation_name, business_number, business_file_key, created_at, updated_at`,
        [
          id,
          String(data.name || '').trim(),
          data.status || 'active',
          Number(data.sortOrder || 0),
          data.logoUrl || '',
          data.corporationName || '',
          data.businessNumber || ''
        ]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url || '',
        corporationName: row.corporation_name || '',
        businessNumber: row.business_number || '',
        businessFileKey: row.business_file_key || '',
        status: row.status,
        sortOrder: row.sort_order,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      };
    },

    async updateDeliveryAgencyLogo(id, logoUrl) {
      const result = await pool.query(
        `UPDATE delivery_agencies
         SET logo_url = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING id, name, status, sort_order, logo_url, corporation_name, business_number, business_file_key, created_at, updated_at`,
        [id, logoUrl || '']
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url || '',
        corporationName: row.corporation_name || '',
        businessNumber: row.business_number || '',
        businessFileKey: row.business_file_key || '',
        status: row.status,
        sortOrder: row.sort_order,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      };
    },

    async updateDeliveryAgencyBusinessFile(id, fileKey) {
      const result = await pool.query(
        `UPDATE delivery_agencies
         SET business_file_key = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING id, name, status, sort_order, logo_url, corporation_name, business_number, business_file_key, created_at, updated_at`,
        [id, fileKey]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        logoUrl: row.logo_url || '',
        corporationName: row.corporation_name || '',
        businessNumber: row.business_number || '',
        businessFileKey: row.business_file_key || '',
        status: row.status,
        sortOrder: row.sort_order,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      };
    },

    async deleteDeliveryAgency(id) {
      const result = await pool.query(
        `UPDATE delivery_agencies
         SET status = 'deleted',
             updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [id]
      );
      return result.rows[0] || null;
    },

    async listInterestFreeInstallments({ onlyActive = false, policyMonth } = {}) {
      const month = normalizePolicyMonth(policyMonth);
      const result = await pool.query(
        `SELECT policy_month, card_company, months, active, display_order, updated_at
         FROM interest_free_installments
         WHERE policy_month = $1::date
         ${onlyActive ? 'AND active = true AND cardinality(months) > 0' : ''}
         ORDER BY display_order ASC, card_company ASC`,
        [month]
      );
      return result.rows.map(row => ({
        policyMonth: row.policy_month instanceof Date ? row.policy_month.toISOString().slice(0, 10) : row.policy_month,
        cardCompany: row.card_company,
        months: Array.isArray(row.months) ? row.months.map(Number).sort((a, b) => a - b) : [],
        active: row.active,
        displayOrder: Number(row.display_order || 0),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      }));
    },

    async replaceInterestFreeInstallments(items, { policyMonth } = {}) {
      const normalized = Array.isArray(items) ? items : [];
      const month = normalizePolicyMonth(policyMonth || normalized[0]?.policyMonth);
      await pool.query('BEGIN');
      try {
        for (const item of normalized) {
          const cardCompany = String(item.cardCompany || '').trim();
          if (!cardCompany) continue;
          const months = [...new Set((Array.isArray(item.months) ? item.months : [])
            .map(Number)
            .filter(month => Number.isInteger(month) && month >= 2 && month <= 12))]
            .sort((a, b) => a - b);
          await pool.query(
            `INSERT INTO interest_free_installments (policy_month, card_company, months, active, display_order, updated_at)
             VALUES ($1::date, $2, $3::int[], $4, $5, now())
             ON CONFLICT (policy_month, card_company) DO UPDATE SET
               months = EXCLUDED.months,
               active = EXCLUDED.active,
               display_order = EXCLUDED.display_order,
               updated_at = now()`,
            [
              month,
              cardCompany,
              months,
              item.active !== false,
              Number(item.displayOrder || 0)
            ]
          );
        }
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
      return this.listInterestFreeInstallments({ policyMonth: month });
    },

    async createAccountRequest(request) {
      const result = await pool.query(
        `INSERT INTO account_requests (
          request_id, franchise_id, franchise_name, business_number, bank_code,
          bank_name, delivery_agency_name, account_no, representative_name, status, document_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)
        RETURNING *`,
        [
          request.requestId,
          request.franchiseId,
          request.franchiseName,
          request.businessNumber,
          request.bankCode,
          request.bankName,
          request.deliveryAgencyName,
          request.accountNo,
          request.representativeName,
          request.documentUrl
        ]
      );
      return toAccountRequest(result.rows[0]);
    },

    async listAccountRequests(options = {}) {
      const includeHidden = options.includeHidden === true;
      const result = await pool.query(`
        SELECT ar.*, sf.original_name AS document_original_name
        FROM account_requests ar
        LEFT JOIN stored_files sf
          ON sf.file_key = regexp_replace(ar.document_url, '^/uploads/', '')
        ${includeHidden ? '' : 'WHERE COALESCE(ar.hidden, false) = false'}
        ORDER BY ar.submitted_at DESC
      `);
      return result.rows.map(toAccountRequest);
    },

    async listAccountRequestsByFranchise(franchiseId) {
      const result = await pool.query(
        `SELECT ar.*, sf.original_name AS document_original_name
         FROM account_requests ar
         LEFT JOIN stored_files sf
           ON sf.file_key = regexp_replace(ar.document_url, '^/uploads/', '')
         WHERE ar.franchise_id = $1
           AND COALESCE(ar.hidden, false) = false
         ORDER BY ar.submitted_at DESC`,
        [franchiseId]
      );
      return result.rows.map(toAccountRequest);
    },

    async updateAccountRequest(requestId, data) {
      const result = await pool.query(
        `UPDATE account_requests
         SET status = $2,
             assigned_virtual_account = $3,
             rejection_reason = $4,
             export_ready_at = CASE WHEN $2 = 'APPROVED' AND export_ready_at IS NULL THEN now() ELSE export_ready_at END,
             processed_at = now(),
             updated_at = now()
         WHERE request_id = $1
         RETURNING *`,
        [
          requestId,
          data.status,
          data.assignedVirtualAccount ? JSON.stringify(data.assignedVirtualAccount) : null,
          data.rejectionReason || null
        ]
      );
      return toAccountRequest(result.rows[0]);
    },

    accountApprovalExportFilters(filters = {}) {
      const params = [];
      const clauses = ["COALESCE(txid, '') = ''"];
      const exportStatus = ['pending', 'exported', 'all'].includes(String(filters.exportStatus || ''))
        ? String(filters.exportStatus)
        : 'pending';
      if (exportStatus === 'pending') clauses.push('exported_at IS NULL');
      if (exportStatus === 'exported') clauses.push('exported_at IS NOT NULL');
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.startDate || ''))) {
        params.push(filters.startDate);
        clauses.push(`export_ready_at::date >= $${params.length}::date`);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.endDate || ''))) {
        params.push(filters.endDate);
        clauses.push(`export_ready_at::date <= $${params.length}::date`);
      }
      const agency = String(filters.agency || '').trim();
      if (agency) {
        params.push(agency);
        clauses.push(`delivery_agency_name = $${params.length}`);
      }
      const q = String(filters.q || '').trim().toLowerCase();
      if (q) {
        params.push(`%${q}%`);
        const index = params.length;
        clauses.push(`(
          lower(COALESCE(franchise_name, '')) LIKE $${index}
          OR lower(COALESCE(account_no, '')) LIKE $${index}
          OR lower(COALESCE(business_number, '')) LIKE $${index}
          OR lower(COALESCE(owner_name, '')) LIKE $${index}
        )`);
      }
      return { params, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '' };
    },

    async listAccountApprovalExportRows(filters = {}) {
      const { params, where } = this.accountApprovalExportFilters(filters);
      const result = await pool.query(
        `WITH export_rows AS (
          SELECT 'account_request' AS source,
                 ar.request_id::text AS id,
                 ar.franchise_id,
                 COALESCE(users.franchise_name, ar.franchise_name) AS franchise_name,
                 COALESCE(users.business_number, ar.business_number) AS business_number,
                 users.name AS owner_name,
                 users.phone AS owner_phone,
                 users.address AS franchise_address,
                 COALESCE(ar.delivery_agency_name, '') AS delivery_agency_name,
                 COALESCE(ar.bank_name, '') AS bank_name,
                 COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber', '') AS account_no,
                 COALESCE(ar.representative_name, users.name, '') AS account_holder,
                 COALESCE(agencies.fee_rate::text, '') AS fee_rate,
                 COALESCE(agencies.name, '') AS sales_name,
                 COALESCE(ar.processed_at, ar.export_ready_at) AS approved_at,
                 ar.export_ready_at,
                 ar.exported_at,
                 ar.txid
          FROM account_requests ar
          LEFT JOIN users ON users.franchise_id = ar.franchise_id
          LEFT JOIN agencies ON agencies.id = users.agency_id
          WHERE ar.status = 'APPROVED'
            AND ar.export_ready_at IS NOT NULL
            AND COALESCE(ar.hidden, false) = false
          UNION ALL
          SELECT 'delivery_account' AS source,
                 da.id::text AS id,
                 da.franchise_id,
                 users.franchise_name AS franchise_name,
                 users.business_number AS business_number,
                 users.name AS owner_name,
                 users.phone AS owner_phone,
                 users.address AS franchise_address,
                 da.agency_name AS delivery_agency_name,
                 da.bank_name,
                 da.account_no,
                 da.account_holder,
                 COALESCE(agencies.fee_rate::text, '') AS fee_rate,
                 COALESCE(agencies.name, '') AS sales_name,
                 COALESCE(da.approved_at, da.export_ready_at, da.updated_at, da.req_date) AS approved_at,
                 da.export_ready_at,
                 da.exported_at,
                 da.txid
          FROM delivery_accounts da
          LEFT JOIN users ON users.franchise_id = da.franchise_id
          LEFT JOIN agencies ON agencies.id = users.agency_id
          WHERE da.account_status = 'APPROVED'
            AND da.export_ready_at IS NOT NULL
            AND COALESCE(da.hidden, false) = false
        )
        SELECT *
        FROM export_rows
        ${where}
        ORDER BY export_ready_at ASC NULLS LAST, approved_at ASC NULLS LAST, source ASC, id ASC`,
        params
      );
      return result.rows;
    },

    async countAccountApprovalExportRows(filters = {}) {
      const { params, where } = this.accountApprovalExportFilters(filters);
      const result = await pool.query(
        `WITH export_rows AS (
          SELECT ar.request_id::text AS id,
                 COALESCE(users.franchise_name, ar.franchise_name) AS franchise_name,
                 COALESCE(users.business_number, ar.business_number) AS business_number,
                 users.name AS owner_name,
                 COALESCE(ar.delivery_agency_name, '') AS delivery_agency_name,
                 COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber', '') AS account_no,
                 ar.export_ready_at,
                 ar.exported_at,
                 ar.txid
          FROM account_requests ar
          LEFT JOIN users ON users.franchise_id = ar.franchise_id
          WHERE ar.status = 'APPROVED'
            AND ar.export_ready_at IS NOT NULL
            AND COALESCE(ar.hidden, false) = false
          UNION ALL
          SELECT da.id::text AS id,
                 users.franchise_name AS franchise_name,
                 users.business_number AS business_number,
                 users.name AS owner_name,
                 da.agency_name AS delivery_agency_name,
                 da.account_no,
                 da.export_ready_at,
                 da.exported_at,
                 da.txid
          FROM delivery_accounts da
          LEFT JOIN users ON users.franchise_id = da.franchise_id
          WHERE da.account_status = 'APPROVED'
            AND da.export_ready_at IS NOT NULL
            AND COALESCE(da.hidden, false) = false
        )
        SELECT count(*)::int AS count
        FROM export_rows
        ${where}`,
        params
      );
      return Number(result.rows[0]?.count || 0);
    },

    async markAccountApprovalsExported(items = [], batchId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const [index, item] of items.entries()) {
          const rowNo = index + 5;
          if (item.source === 'account_request') {
            await client.query(
              `UPDATE account_requests
               SET exported_at = now(), export_batch_id = $2, export_row_no = $3, updated_at = now()
               WHERE request_id = $1`,
              [String(item.id), batchId, rowNo]
            );
          }
          if (item.source === 'delivery_account') {
            await client.query(
              `UPDATE delivery_accounts
               SET exported_at = now(), export_batch_id = $2, export_row_no = $3, updated_at = now()
               WHERE id = $1`,
              [Number(item.id), batchId, rowNo]
            );
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async applyAccountApprovalTxids(items = [], options = {}) {
      const client = await pool.connect();
      const results = [];
      const batchId = String(options.batchId || '').trim();
      try {
        await client.query('BEGIN');
        for (const item of items) {
          const txid = String(item.txid || '').trim();
          const accountNo = normalizeAccountNo(item.accountNo);
          const businessNumber = String(item.businessNumber || '').replace(/[^0-9]/g, '');
          const franchiseName = String(item.franchiseName || '').trim();
          if (!txid || !accountNo) {
            results.push({ ...item, status: 'SKIPPED' });
            continue;
          }
          if (!isValidAccountApprovalTxid(txid)) {
            results.push({ ...item, status: 'INVALID_TXID' });
            continue;
          }
          let candidates = [];
          if (batchId && Number.isFinite(Number(item.rowNo))) {
            const byRow = await client.query(
              `SELECT source, id
               FROM (
                 SELECT 'delivery_account' AS source, id::text AS id
                 FROM delivery_accounts
                 WHERE export_batch_id = $1 AND export_row_no = $2
                   AND account_status = 'APPROVED'
                 UNION ALL
                 SELECT 'account_request' AS source, request_id AS id
                 FROM account_requests
                 WHERE export_batch_id = $1 AND export_row_no = $2
                   AND status = 'APPROVED'
               ) matched`,
              [batchId, Number(item.rowNo)]
            );
            candidates = byRow.rows;
          }
          if (!candidates.length) {
            const byAccount = await client.query(
              `SELECT source, id
               FROM (
                 SELECT 'delivery_account' AS source, da.id::text AS id
                 FROM delivery_accounts da
                 JOIN users ON users.franchise_id = da.franchise_id
                 WHERE da.account_status = 'APPROVED'
                   AND COALESCE(da.txid, '') = ''
                   AND regexp_replace(COALESCE(da.account_no, ''), '[^0-9A-Za-z]', '', 'g') = $1
                   AND ($2::text IS NULL OR regexp_replace(COALESCE(users.business_number, ''), '[^0-9]', '', 'g') = $2)
                   AND ($3::text IS NULL OR users.franchise_name = $3)
                 UNION ALL
                 SELECT 'account_request' AS source, ar.request_id AS id
                 FROM account_requests ar
                 WHERE ar.status = 'APPROVED'
                   AND COALESCE(ar.txid, '') = ''
                   AND regexp_replace(COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber', ''), '[^0-9A-Za-z]', '', 'g') = $1
                   AND ($2::text IS NULL OR regexp_replace(COALESCE(ar.business_number, ''), '[^0-9]', '', 'g') = $2)
                   AND ($3::text IS NULL OR ar.franchise_name = $3)
               ) matched`,
              [accountNo, businessNumber || null, franchiseName || null]
            );
            candidates = byAccount.rows;
          }
          if (candidates.length !== 1) {
            results.push({ ...item, status: candidates.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND', affected: candidates });
            continue;
          }
          const target = candidates[0];
          if (target.source === 'delivery_account') {
            await client.query(
              `UPDATE delivery_accounts
               SET txid = $1, txid_uploaded_at = now(), updated_at = now()
               WHERE id = $2`,
              [txid, Number(target.id)]
            );
          } else {
            await client.query(
              `UPDATE account_requests
               SET txid = $1, txid_uploaded_at = now(), updated_at = now()
               WHERE request_id = $2`,
              [txid, String(target.id)]
            );
          }
          results.push({ ...item, status: 'UPDATED', affected: [target] });
        }
        await client.query('COMMIT');
        return results;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async findAccountApprovalNotificationTarget(source, id) {
      const normalizedSource = String(source || '').trim();
      if (normalizedSource === 'delivery_account') {
        const result = await pool.query(
          `SELECT users.id AS user_id,
                  users.franchise_id,
                  users.franchise_name,
                  da.id::text AS account_id,
                  da.agency_name,
                  da.bank_name,
                  da.account_no,
                  da.txid
           FROM delivery_accounts da
           JOIN users ON users.franchise_id = da.franchise_id
           WHERE da.id = $1`,
          [Number(id)]
        );
        return result.rows[0] || null;
      }
      if (normalizedSource === 'account_request') {
        const result = await pool.query(
          `SELECT users.id AS user_id,
                  COALESCE(users.franchise_id, ar.franchise_id) AS franchise_id,
                  COALESCE(users.franchise_name, ar.franchise_name) AS franchise_name,
                  ar.request_id AS account_id,
                  ar.delivery_agency_name AS agency_name,
                  ar.bank_name,
                  COALESCE(ar.account_no, ar.assigned_virtual_account->>'accountNumber') AS account_no,
                  ar.txid
           FROM account_requests ar
           JOIN users ON users.franchise_id = ar.franchise_id
           WHERE ar.request_id = $1`,
          [String(id)]
        );
        return result.rows[0] || null;
      }
      return null;
    },

    async findChargeDepositAccount({ franchiseId, accountId, source }) {
      if (source === 'delivery_account' || /^\d+$/.test(String(accountId || ''))) {
        const result = await pool.query(
          `SELECT 'delivery_account' AS source, id::text AS id, franchise_id, agency_name, bank_name, account_no, account_holder, txid
           FROM delivery_accounts
           WHERE id = $1 AND franchise_id = $2 AND account_status = 'APPROVED' AND COALESCE(hidden, false) = false`,
          [Number(accountId), franchiseId]
        );
        if (result.rows[0]) return result.rows[0];
      }
      const result = await pool.query(
        `SELECT 'account_request' AS source, request_id AS id, franchise_id, delivery_agency_name AS agency_name,
                bank_name, COALESCE(account_no, assigned_virtual_account->>'accountNumber') AS account_no,
                representative_name AS account_holder, txid
         FROM account_requests
         WHERE request_id = $1 AND franchise_id = $2 AND status = 'APPROVED' AND COALESCE(hidden, false) = false`,
        [String(accountId || ''), franchiseId]
      );
      return result.rows[0] || null;
    },

    async findAccountRequest(requestId) {
      const result = await pool.query('SELECT * FROM account_requests WHERE request_id = $1', [requestId]);
      return toAccountRequest(result.rows[0]);
    },

    async updateAccountRequestDetails(requestId, data) {
      const result = await pool.query(
        `UPDATE account_requests
         SET bank_name = COALESCE($2, bank_name),
             delivery_agency_name = COALESCE($3, delivery_agency_name),
             account_no = COALESCE($4, account_no),
             representative_name = COALESCE($5, representative_name),
             document_url = COALESCE($6, document_url),
             updated_at = now()
         WHERE request_id = $1
         RETURNING *`,
        [
          requestId,
          data.bankName || null,
          data.deliveryAgencyName || null,
          data.accountNo || null,
          data.representativeName || null,
          data.documentUrl || null
        ]
      );
      return toAccountRequest(result.rows[0]);
    },

    async deleteAccountRequest(requestId) {
      const result = await pool.query(
        'DELETE FROM account_requests WHERE request_id = $1 RETURNING *',
        [requestId]
      );
      return toAccountRequest(result.rows[0]);
    },

    async deleteAccountRequestByFranchise(requestId, franchiseId) {
      const result = await pool.query(
        'DELETE FROM account_requests WHERE request_id = $1 AND franchise_id = $2 RETURNING *',
        [requestId, franchiseId]
      );
      return toAccountRequest(result.rows[0]);
    },

    async updateAccountRequestVisibilityByFranchise(requestId, franchiseId, data) {
      const result = await pool.query(
        `UPDATE account_requests
         SET active = COALESCE($3, active),
             hidden = COALESCE($4, hidden)
         WHERE request_id = $1 AND franchise_id = $2
         RETURNING *`,
        [
          requestId,
          franchiseId,
          typeof data.active === 'boolean' ? data.active : null,
          typeof data.hidden === 'boolean' ? data.hidden : null
        ]
      );
      return toAccountRequest(result.rows[0]);
    },

    async updateAccountRequestVisibility(requestId, data) {
      const result = await pool.query(
        `UPDATE account_requests
         SET active = COALESCE($2, active),
             hidden = COALESCE($3, hidden),
             updated_at = now()
         WHERE request_id = $1
         RETURNING *`,
        [
          requestId,
          typeof data.active === 'boolean' ? data.active : null,
          typeof data.hidden === 'boolean' ? data.hidden : null
        ]
      );
      return toAccountRequest(result.rows[0]);
    },

    async recordCharge(charge) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pg TEXT`);
        await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pg_tx_id TEXT`);
        await client.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS auth_code TEXT`);
        const updated = await client.query(
          'UPDATE users SET balance = balance + $2, updated_at = now() WHERE id = $1 RETURNING balance',
          [charge.userId, charge.amount]
        );
        await client.query(
          `INSERT INTO transactions (
            transaction_id, franchise_id, type, amount, fee, total_amount,
            method, card_details, pg, pg_tx_id, auth_code, status
          )
          VALUES ($1, $2, 'CHARGE', $3, $4, $5, $6, $7, $8, $9, $10, 'SUCCESS')`,
          [
            charge.transactionId,
            charge.franchiseId,
            charge.amount,
            charge.fee,
            charge.totalAmount,
            charge.method,
            charge.cardDetails,
            charge.pg || null,
            charge.pgTxId || null,
            charge.authCode || null
          ]
        );
        if (false && charge.pgTxId) {
          const meta = await client.query(
            `SELECT
               u.franchise_name,
               u.customer_id,
               u.login_id,
               u.agency_id,
               a.name AS agency_name,
               COALESCE(da.bank_name, ar.bank_name, ar.assigned_virtual_account->>'bankName') AS bank_name,
               COALESCE(da.account_no, ar.account_no, ar.assigned_virtual_account->>'accountNumber') AS account_no,
               COALESCE(da.agency_name, ar.delivery_agency_name) AS delivery_agency
             FROM users u
             LEFT JOIN agencies a ON a.id = u.agency_id
             LEFT JOIN LATERAL (
               SELECT bank_name, account_no, agency_name
               FROM delivery_accounts
               WHERE franchise_id = u.franchise_id
                 AND account_status = 'APPROVED'
                 AND COALESCE(hidden, false) = false
                 AND COALESCE(active, true) = true
               ORDER BY updated_at DESC, req_date DESC
               LIMIT 1
             ) da ON true
             LEFT JOIN LATERAL (
               SELECT bank_name, account_no, delivery_agency_name, assigned_virtual_account
               FROM account_requests
               WHERE franchise_id = u.franchise_id
                 AND status IN ('APPROVED', '승인완료')
               ORDER BY updated_at DESC, submitted_at DESC
               LIMIT 1
             ) ar ON true
             WHERE u.id = $1
             LIMIT 1`,
            [charge.userId]
          );
          const info = meta.rows[0] || {};
          await client.query(
            `INSERT INTO pg_settlements (
              settled_at, approval_no, pg, pg_tx_id, franchise_id, franchise_name,
              payment_amt, svc_fee, net_amt, agency_id, agency_name, customer_id,
              bank_code, account_no, delivery_agency, status
            )
            VALUES (
              now(), $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11,
              $12, $13, $14, 'SETTLED'
            )
            ON CONFLICT (approval_no) DO UPDATE SET
              pg = EXCLUDED.pg,
              pg_tx_id = EXCLUDED.pg_tx_id,
              payment_amt = EXCLUDED.payment_amt,
              svc_fee = EXCLUDED.svc_fee,
              net_amt = EXCLUDED.net_amt,
              updated_at = now()`,
            [
              charge.transactionId,
              charge.pg || 'GH Payments',
              charge.pgTxId,
              charge.franchiseId,
              info.franchise_name || `가맹점 ${charge.franchiseId}`,
              charge.totalAmount,
              charge.fee,
              charge.amount,
              info.agency_id || null,
              info.agency_name || null,
              info.customer_id || info.login_id || null,
              info.bank_name || null,
              info.account_no || null,
              info.delivery_agency || null
            ]
          );
        }
        await client.query('COMMIT');
        return { updatedBalance: Number(updated.rows[0].balance) };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async listTransactions(filters) {
      const whereParams = [filters.startDate, filters.endDate];
      let where = "created_at::date BETWEEN $1::date AND $2::date";
      if (filters.role === 'OWNER') {
        whereParams.push(filters.franchiseId);
        where += ` AND franchise_id = $${whereParams.length}`;
      }
      if (filters.type && filters.type !== 'ALL') {
        whereParams.push(filters.type);
        where += ` AND type = $${whereParams.length}`;
      }

      const items = await pool.query(
        `SELECT * FROM transactions
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
        [...whereParams, filters.limit, filters.offset]
      );
      const count = await pool.query(`SELECT count(*)::int AS count FROM transactions WHERE ${where}`, whereParams);
      return {
        items: items.rows.map(toTransaction),
        totalItems: count.rows[0]?.count || 0
      };
    },

    async listPgSettlements(filters = {}) {
      const whereParts = [];
      const params = [];
      if (filters.startDate) {
        params.push(filters.startDate);
        whereParts.push(`COALESCE(ps.settled_at, t.created_at)::date >= $${params.length}::date`);
      }
      if (filters.endDate) {
        params.push(filters.endDate);
        whereParts.push(`COALESCE(ps.settled_at, t.created_at)::date <= $${params.length}::date`);
      }
      if (filters.agencyId) {
        params.push(filters.agencyId);
        whereParts.push(`COALESCE(ps.agency_id, u.agency_id) = $${params.length}`);
      }
      if (filters.status) {
        params.push(filters.status);
        whereParts.push(`ps.status = $${params.length}`);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
      const limit = filters.limit || 50;
      const offset = filters.offset || 0;

      const items = await pool.query(
        `SELECT ps.*,
                COALESCE(ps.agency_id, u.agency_id) AS resolved_agency_id,
                COALESCE(NULLIF(ps.agency_name, ''), a.name) AS resolved_agency_name
         FROM pg_settlements ps
         LEFT JOIN transactions t ON t.transaction_id = ps.approval_no
         LEFT JOIN users u ON u.franchise_id = ps.franchise_id
         LEFT JOIN agencies a ON a.id = COALESCE(ps.agency_id, u.agency_id)
         ${where}
         ORDER BY COALESCE(ps.settled_at, t.created_at, ps.created_at) DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const count = await pool.query(
        `SELECT count(*)::int AS count
         FROM pg_settlements ps
         LEFT JOIN transactions t ON t.transaction_id = ps.approval_no
         LEFT JOIN users u ON u.franchise_id = ps.franchise_id
         ${where}`,
        params
      );
      return {
        items: items.rows.map(toPgSettlement),
        totalItems: count.rows[0]?.count || 0
      };
    },

    async rollbackPgSettlement(id) {
      const result = await pool.query(
        "UPDATE pg_settlements SET status = 'ROLLED_BACK', updated_at = now() WHERE id = $1 RETURNING *",
        [id]
      );
      return toPgSettlement(result.rows[0]);
    },

    async listPgProviders() {
      const result = await pool.query(
        `SELECT * FROM pg_providers
         ORDER BY display_order ASC, id ASC`
      );
      return result.rows.map(toPgProvider);
    },

    async recordPgNotification(notification) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `INSERT INTO pg_notifications (
            provider, event_type, transaction_id, pg_transaction_id,
            result_code, result_message, payload, query, headers
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
          RETURNING id, received_at`,
          [
            notification.provider || 'GH Payments',
            notification.eventType || null,
            notification.transactionId || null,
            notification.pgTransactionId || null,
            notification.resultCode || null,
            notification.resultMessage || null,
            JSON.stringify(notification.payload || {}),
            JSON.stringify(notification.query || {}),
            JSON.stringify(notification.headers || {})
          ]
        );
        const row = result.rows[0];
        const settlementAt = findProviderSettlementTime(notification.payload || {});
        if (notification.transactionId && notification.pgTransactionId) {
          await client.query(
            `UPDATE transactions
             SET pg = COALESCE(pg, $2),
                 pg_tx_id = COALESCE(pg_tx_id, $3),
                 auth_code = COALESCE(auth_code, $4),
                 updated_at = now()
             WHERE transaction_id = $1`,
            [
              notification.transactionId,
              notification.provider || 'GH Payments',
              notification.pgTransactionId,
              notification.payload?.pay?.authCd || notification.payload?.authCd || null
            ]
          );
          await client.query(
            `INSERT INTO pg_settlements (
              settled_at, approval_no, pg, pg_tx_id, franchise_id, franchise_name,
              payment_amt, svc_fee, net_amt, agency_id, agency_name, customer_id,
              bank_code, account_no, delivery_agency, status
            )
            SELECT
              $3,
              t.transaction_id,
              COALESCE(t.pg, $4),
              $2,
              t.franchise_id,
              COALESCE(u.franchise_name, '가맹점 ' || t.franchise_id::text),
              t.total_amount,
              t.fee,
              t.amount,
              u.agency_id,
              a.name,
              COALESCE(NULLIF(u.customer_id, ''), u.login_id),
              COALESCE(da.bank_name, ar.bank_name, ar.assigned_virtual_account->>'bankName'),
              COALESCE(da.account_no, ar.account_no, ar.assigned_virtual_account->>'accountNumber'),
              COALESCE(da.agency_name, ar.delivery_agency_name),
              CASE WHEN $3::timestamptz IS NULL THEN 'NORMAL_APPROVED' ELSE 'SETTLED' END
            FROM transactions t
            LEFT JOIN users u ON u.franchise_id = t.franchise_id
            LEFT JOIN agencies a ON a.id = u.agency_id
            LEFT JOIN LATERAL (
              SELECT bank_name, account_no, agency_name
              FROM delivery_accounts
              WHERE franchise_id = t.franchise_id
                AND account_status = 'APPROVED'
                AND COALESCE(hidden, false) = false
                AND COALESCE(active, true) = true
              ORDER BY updated_at DESC, req_date DESC
              LIMIT 1
            ) da ON true
            LEFT JOIN LATERAL (
              SELECT bank_name, account_no, delivery_agency_name, assigned_virtual_account
              FROM account_requests
              WHERE franchise_id = t.franchise_id
                AND status IN ('APPROVED', '승인완료')
              ORDER BY updated_at DESC, submitted_at DESC
              LIMIT 1
            ) ar ON true
            WHERE t.transaction_id = $1
            ON CONFLICT (approval_no) DO UPDATE SET
              settled_at = EXCLUDED.settled_at,
              pg = EXCLUDED.pg,
              pg_tx_id = EXCLUDED.pg_tx_id,
              payment_amt = EXCLUDED.payment_amt,
              svc_fee = EXCLUDED.svc_fee,
              net_amt = EXCLUDED.net_amt,
              agency_id = EXCLUDED.agency_id,
              agency_name = EXCLUDED.agency_name,
              customer_id = EXCLUDED.customer_id,
              bank_code = EXCLUDED.bank_code,
              account_no = EXCLUDED.account_no,
              delivery_agency = EXCLUDED.delivery_agency,
              status = EXCLUDED.status,
              updated_at = now()`,
            [
              notification.transactionId,
              notification.pgTransactionId,
              settlementAt,
              notification.provider || 'GH Payments'
            ]
          );
        }
        await client.query('COMMIT');
        return {
          id: row.id,
          receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async createPgProvider(provider) {
      const result = await pool.query(
        `INSERT INTO pg_providers (
          name, mid, api_key, callback_url, status, note, display_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          provider.name,
          provider.mid || '',
          provider.apiKey || '',
          provider.callbackUrl || '',
          provider.status || '활성',
          provider.note || '',
          provider.displayOrder || 0
        ]
      );
      return toPgProvider(result.rows[0]);
    },

    async updatePgProvider(id, provider) {
      const result = await pool.query(
        `UPDATE pg_providers
         SET name = $2,
             mid = $3,
             api_key = CASE WHEN $4 = '' THEN api_key ELSE $4 END,
             callback_url = $5,
             status = $6,
             note = $7,
             display_order = $8,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          provider.name,
          provider.mid || '',
          provider.apiKey || '',
          provider.callbackUrl || '',
          provider.status || '활성',
          provider.note || '',
          provider.displayOrder || 0
        ]
      );
      return toPgProvider(result.rows[0]);
    },

    async deletePgProvider(id) {
      const result = await pool.query('DELETE FROM pg_providers WHERE id = $1 RETURNING *', [id]);
      return toPgProvider(result.rows[0]);
    },

    async setPgProviderStatus(id, status) {
      const result = await pool.query(
        'UPDATE pg_providers SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [id, status]
      );
      return toPgProvider(result.rows[0]);
    },

    async listAgencyInquiries() {
      const result = await pool.query(
        `SELECT * FROM agency_inquiries
         ORDER BY created_at DESC, id DESC`
      );
      return result.rows.map(toAgencyInquiry);
    },

    async createAgencyInquiry(inquiry) {
      const result = await pool.query(
        `INSERT INTO agency_inquiries (
          name, phone, delivery_agency, region, handler, status
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
          inquiry.name,
          inquiry.phone || '',
          inquiry.deliveryAgency || '',
          inquiry.region || '',
          inquiry.handler || '',
          inquiry.status || '상담 대기'
        ]
      );
      return toAgencyInquiry(result.rows[0]);
    },

    async updateAgencyInquiry(id, inquiry) {
      const result = await pool.query(
        `UPDATE agency_inquiries
         SET name = $2,
             phone = $3,
             delivery_agency = $4,
             region = $5,
             handler = $6,
             status = $7,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          inquiry.name,
          inquiry.phone || '',
          inquiry.deliveryAgency || '',
          inquiry.region || '',
          inquiry.handler || '',
          inquiry.status || '상담 대기'
        ]
      );
      return toAgencyInquiry(result.rows[0]);
    },

    async updateAgencyInquiryStatus(id, status) {
      const result = await pool.query(
        `UPDATE agency_inquiries
         SET status = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, status]
      );
      return toAgencyInquiry(result.rows[0]);
    },

    async deleteAgencyInquiry(id) {
      const result = await pool.query('DELETE FROM agency_inquiries WHERE id = $1 RETURNING *', [id]);
      return toAgencyInquiry(result.rows[0]);
    },

    async listBoardPosts(boardType, options = {}) {
      const includeInactive = Boolean(options.includeInactive);
      const limit = Number(options.limit) || 100;
      const result = await pool.query(
        `SELECT * FROM board_posts
         WHERE board_type = $1
           AND ($2::boolean OR active = true)
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [boardType, includeInactive, limit]
      );
      return result.rows.map(toBoardPost);
    },

    async createBoardPost(boardType, post) {
      const result = await pool.query(
        `INSERT INTO board_posts (board_type, title, author, content, active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          boardType,
          post.title,
          post.author || '운영팀',
          post.content,
          post.active !== false
        ]
      );
      return toBoardPost(result.rows[0]);
    },

    async updateBoardPost(boardType, id, post) {
      const result = await pool.query(
        `UPDATE board_posts
         SET title = $3,
             author = $4,
             content = $5,
             active = COALESCE($6, active),
             updated_at = now()
         WHERE board_type = $1 AND id = $2
         RETURNING *`,
        [
          boardType,
          id,
          post.title,
          post.author || '운영팀',
          post.content,
          typeof post.active === 'boolean' ? post.active : null
        ]
      );
      return toBoardPost(result.rows[0]);
    },

    async deleteBoardPost(boardType, id) {
      const result = await pool.query(
        'DELETE FROM board_posts WHERE board_type = $1 AND id = $2 RETURNING *',
        [boardType, id]
      );
      return toBoardPost(result.rows[0]);
    },

    async listFaqs(options = {}) {
      const includeInactive = Boolean(options.includeInactive);
      const result = await pool.query(
        `SELECT f.*
         FROM faqs f
         LEFT JOIN faq_categories fc ON fc.name = f.category
         WHERE ($1::boolean OR f.active = true)
         ORDER BY COALESCE(fc.display_order, 999999) ASC, f.display_order ASC, f.category ASC, f.id ASC`,
        [includeInactive]
      );
      return result.rows.map(toFaq);
    },

    async createFaq(faq) {
      const category = faq.category || '서비스 안내';
      await pool.query(
        `INSERT INTO faq_categories (name, display_order)
         VALUES ($1, COALESCE((SELECT MAX(display_order) + 1 FROM faq_categories), 1))
         ON CONFLICT (name) DO NOTHING`,
        [category]
      );
      const result = await pool.query(
        `INSERT INTO faqs (category, question, answer, active, display_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          category,
          faq.question,
          faq.answer,
          faq.active !== false,
          Number(faq.displayOrder) || 0
        ]
      );
      return toFaq(result.rows[0]);
    },

    async updateFaq(id, faq) {
      const category = faq.category || '서비스 안내';
      await pool.query(
        `INSERT INTO faq_categories (name, display_order)
         VALUES ($1, COALESCE((SELECT MAX(display_order) + 1 FROM faq_categories), 1))
         ON CONFLICT (name) DO NOTHING`,
        [category]
      );
      const result = await pool.query(
        `UPDATE faqs
         SET category = $2,
             question = $3,
             answer = $4,
             active = COALESCE($5, active),
             display_order = COALESCE($6, display_order),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          category,
          faq.question,
          faq.answer,
          typeof faq.active === 'boolean' ? faq.active : null,
          Number.isFinite(Number(faq.displayOrder)) ? Number(faq.displayOrder) : null
        ]
      );
      return toFaq(result.rows[0]);
    },

    async updateFaqOrder(ids = []) {
      const normalized = ids.map(Number).filter(Number.isFinite);
      if (!normalized.length) return [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < normalized.length; i += 1) {
          await client.query(
            'UPDATE faqs SET display_order = $2, updated_at = now() WHERE id = $1',
            [normalized[i], i + 1]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      const result = await pool.query(
        `SELECT * FROM faqs
         WHERE id = ANY($1::int[])
         ORDER BY display_order ASC, category ASC, id ASC`,
        [normalized]
      );
      return result.rows.map(toFaq);
    },

    async updateFaqCategoryOrder(categories = []) {
      const normalized = categories.map(item => String(item || '').trim()).filter(Boolean);
      if (!normalized.length) return [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < normalized.length; i += 1) {
          await client.query(
            `INSERT INTO faq_categories (name, display_order, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (name)
             DO UPDATE SET display_order = EXCLUDED.display_order, updated_at = now()`,
            [normalized[i], i + 1]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      return normalized.map((name, index) => ({ name, displayOrder: index + 1 }));
    },

    async renameFaqCategory(oldCategory, newCategory) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO faq_categories (name, display_order)
           SELECT $2, display_order FROM faq_categories WHERE name = $1
           ON CONFLICT (name) DO UPDATE SET display_order = EXCLUDED.display_order, updated_at = now()`,
          [oldCategory, newCategory]
        );
        await client.query('DELETE FROM faq_categories WHERE name = $1', [oldCategory]);
        const result = await client.query(
          `UPDATE faqs
           SET category = $2, updated_at = now()
           WHERE category = $1
           RETURNING *`,
          [oldCategory, newCategory]
        );
        await client.query('COMMIT');
        return result.rows.map(toFaq);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async deleteFaqCategory(category) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM faq_categories WHERE name = $1', [category]);
        const result = await client.query('DELETE FROM faqs WHERE category = $1 RETURNING *', [category]);
        await client.query('COMMIT');
        return result.rows.map(toFaq);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async deleteFaq(id) {
      const result = await pool.query('DELETE FROM faqs WHERE id = $1 RETURNING *', [id]);
      return toFaq(result.rows[0]);
    },

    async listBanners(options = {}) {
      const includeInactive = Boolean(options.includeInactive);
      const result = await pool.query(
        `SELECT * FROM banners
         WHERE ($1::boolean OR status = '활성')
         ORDER BY display_order ASC, id DESC`,
        [includeInactive]
      );
      return result.rows.map(toBanner);
    },

    async createBanner(banner) {
      const result = await pool.query(
        `INSERT INTO banners (
          type, title, subtitle, url, image_url, detail_title, detail_subtitle, detail_image_url, status, display_order, start_at, end_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, '')::timestamptz, NULLIF($12, '')::timestamptz)
        RETURNING *`,
        [
          banner.type || '메인',
          banner.title,
          banner.subtitle || '',
          banner.url || '',
          banner.imageUrl || '',
          banner.detailTitle || '',
          banner.detailSubtitle || '',
          banner.detailImageUrl || '',
          banner.status || '활성',
          Number(banner.displayOrder ?? banner.order) || 0,
          banner.startAt || '',
          banner.endAt || ''
        ]
      );
      return toBanner(result.rows[0]);
    },

    async updateBanner(id, banner) {
      const result = await pool.query(
        `UPDATE banners
         SET type = $2,
             title = $3,
             subtitle = $4,
             url = $5,
             image_url = $6,
             detail_title = $7,
             detail_subtitle = $8,
             detail_image_url = $9,
             status = $10,
             display_order = $11,
             start_at = NULLIF($12, '')::timestamptz,
             end_at = NULLIF($13, '')::timestamptz,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          banner.type || '메인',
          banner.title,
          banner.subtitle || '',
          banner.url || '',
          banner.imageUrl || '',
          banner.detailTitle || '',
          banner.detailSubtitle || '',
          banner.detailImageUrl || '',
          banner.status || '활성',
          Number(banner.displayOrder ?? banner.order) || 0,
          banner.startAt || '',
          banner.endAt || ''
        ]
      );
      return toBanner(result.rows[0]);
    },

    async setBannerStatus(id, status) {
      const result = await pool.query(
        `UPDATE banners
         SET status = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, status]
      );
      return toBanner(result.rows[0]);
    },

    async deleteBanner(id) {
      const result = await pool.query('DELETE FROM banners WHERE id = $1 RETURNING *', [id]);
      return toBanner(result.rows[0]);
    },

    async listLegalDocuments(options = {}) {
      const activeOnly = Boolean(options.activeOnly);
      const result = await pool.query(
        `SELECT * FROM legal_documents
         WHERE ($1::boolean = false OR applied = true)
         ORDER BY type ASC, applied DESC, applied_at DESC NULLS LAST, created_at DESC, id DESC`,
        [activeOnly]
      );
      return result.rows.map(toLegalDocument);
    },

    async createLegalDocument(doc) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (doc.applied) {
          await client.query(
            `UPDATE legal_documents
             SET applied = false, applied_at = NULL, updated_at = now()
             WHERE type = $1`,
            [doc.type]
          );
        }
        const result = await client.query(
          `INSERT INTO legal_documents (type, title, content, source_file_name, applied, applied_at)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() ELSE NULL END)
           RETURNING *`,
          [doc.type, doc.title, doc.content, doc.sourceFileName || '', doc.applied === true]
        );
        await client.query('COMMIT');
        return toLegalDocument(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async applyLegalDocument(id, applied) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query('SELECT * FROM legal_documents WHERE id = $1', [id]);
        const current = found.rows[0];
        if (!current) {
          await client.query('ROLLBACK');
          return null;
        }
        if (applied) {
          await client.query(
            `UPDATE legal_documents
             SET applied = false, applied_at = NULL, updated_at = now()
             WHERE type = $1`,
            [current.type]
          );
        }
        const result = await client.query(
          `UPDATE legal_documents
           SET applied = $2,
               applied_at = CASE WHEN $2 THEN now() ELSE NULL END,
               updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [id, applied === true]
        );
        await client.query('COMMIT');
        return toLegalDocument(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async deleteLegalDocument(id) {
      const result = await pool.query('DELETE FROM legal_documents WHERE id = $1 RETURNING *', [id]);
      return toLegalDocument(result.rows[0]);
    },

    async searchBenefitCards(query = '', limit = 100) {
      const term = String(query || '').trim();
      const safeLimit = Math.min(Math.max(Number(limit || 100), 1), 100);
      const params = term ? [`%${term}%`, safeLimit] : [safeLimit];
      const sql = term
        ? `SELECT id, source, source_url, rank_no, card_company, card_name, summary, discount_rate, annual_fee, tags, source_card_idx, image_url, event_title, updated_at
           FROM benefit_cards
           WHERE active = true
             AND (card_company ILIKE $1 OR card_name ILIKE $1 OR summary ILIKE $1 OR array_to_string(tags, ' ') ILIKE $1)
           ORDER BY rank_no ASC NULLS LAST, card_company ASC, card_name ASC
           LIMIT $2`
        : `SELECT id, source, source_url, rank_no, card_company, card_name, summary, discount_rate, annual_fee, tags, source_card_idx, image_url, event_title, updated_at
           FROM benefit_cards
           WHERE active = true
           ORDER BY rank_no ASC NULLS LAST, card_company ASC, card_name ASC
           LIMIT $1`;
      const result = await pool.query(sql, params);
      return result.rows.map(row => ({
        id: row.id,
        source: row.source,
        sourceUrl: row.source_url || '',
        rank: Number(row.rank_no || 0),
        cardCompany: row.card_company,
        cardName: row.card_name,
        summary: row.summary,
        discountRate: Number(row.discount_rate || 0),
        annualFee: row.annual_fee,
        tags: Array.isArray(row.tags) ? row.tags : [],
        sourceCardIdx: row.source_card_idx || '',
        imageUrl: row.image_url || '',
        eventTitle: row.event_title || '',
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      }));
    },

    async upsertBenefitCardsFromCardGorilla(cards) {
      const rows = Array.isArray(cards) ? cards : [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "UPDATE benefit_cards SET active = false, updated_at = now() WHERE source IN ('cardgorilla', 'card-gorilla', 'manual')"
        );
        for (const card of rows) {
          await client.query(
            `INSERT INTO benefit_cards (
               source, source_url, rank_no, card_company, card_name, summary,
               discount_rate, annual_fee, tags, source_card_idx, image_url, event_title, active, updated_at
             )
             VALUES (
               'cardgorilla', $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11, $12, now()
             )
             ON CONFLICT (source, card_company, card_name)
             DO UPDATE SET
               source_url = EXCLUDED.source_url,
               rank_no = EXCLUDED.rank_no,
               summary = EXCLUDED.summary,
               discount_rate = EXCLUDED.discount_rate,
               annual_fee = EXCLUDED.annual_fee,
               tags = EXCLUDED.tags,
               source_card_idx = EXCLUDED.source_card_idx,
               image_url = EXCLUDED.image_url,
               event_title = EXCLUDED.event_title,
               active = EXCLUDED.active,
               updated_at = now()`,
            [
              card.sourceUrl || '',
              card.rankNo,
              card.cardCompany,
              card.cardName,
              card.summary || '',
              Number(card.discountRate || 0),
              card.annualFee || '',
              Array.isArray(card.tags) ? card.tags : [],
              card.sourceCardIdx || '',
              card.imageUrl || '',
              card.eventTitle || '',
              card.active !== false
            ]
          );
        }
        await client.query('COMMIT');
        return { imported: rows.length };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async findTransaction(transactionId) {
      const result = await pool.query('SELECT * FROM transactions WHERE transaction_id = $1', [transactionId]);
      return toTransaction(result.rows[0]);
    },

    async rollbackTransaction({ transactionId, franchiseId, amount }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const user = await client.query(
          'SELECT balance FROM users WHERE franchise_id = $1 FOR UPDATE',
          [franchiseId]
        );
        if (!user.rows[0]) {
          const err = new Error('FRANCHISE_NOT_FOUND');
          err.code = 'FRANCHISE_NOT_FOUND';
          throw err;
        }
        if (Number(user.rows[0].balance) < amount) {
          const err = new Error('INSUFFICIENT_BALANCE');
          err.code = 'INSUFFICIENT_BALANCE';
          throw err;
        }
        const updated = await client.query(
          'UPDATE users SET balance = balance - $2, updated_at = now() WHERE franchise_id = $1 RETURNING balance',
          [franchiseId, amount]
        );
        await client.query(
          "UPDATE transactions SET status = 'ROLLED_BACK', updated_at = now() WHERE transaction_id = $1",
          [transactionId]
        );
        await client.query('COMMIT');
        return { deductedFranchiseBalance: Number(updated.rows[0].balance) };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  };
}

module.exports = {
  createRepository
};
