function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    franchiseName: row.franchise_name,
    franchiseId: row.franchise_id,
    role: row.role,
    balance: Number(row.balance || 0),
    phone: row.phone,
    address: row.address,
    tel: row.tel,
    businessNumber: row.business_number,
    customerId: row.customer_id,
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    bizDocFileKey: row.biz_doc_file_key,
    posFileKey: row.pos_file_key,
    createdAt: row.created_at
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
    submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at,
    assignedVirtualAccount: row.assigned_virtual_account,
    rejectionReason: row.rejection_reason
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
    title: row.title,
    postTitle: row.post_title,
    franchiseName: row.franchise_name,
    sellerName: row.seller_name,
    buyerName: row.buyer_name,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at instanceof Date ? row.last_message_at.toISOString() : row.last_message_at,
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
    accountStatus: row.account_status,
    rejectionReason: row.rejection_reason,
    reqDate: row.req_date instanceof Date ? row.req_date.toISOString() : row.req_date
  };
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
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    customerId: row.customer_id,
    bankCode: row.bank_code,
    accountNo: row.account_no,
    deliveryAgency: row.delivery_agency,
    status: row.status
  };
}

function toAgency(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    name: row.name,
    address: row.address,
    loginId: row.login_id,
    passwordHash: row.password_hash,
    owner: row.owner,
    phone: row.phone,
    feeRate: Number(row.fee_rate || 0),
    joinCode: row.join_code,
    contractFileKey: row.contract_file_key,
    settleBankName: row.settle_bank_name,
    settleAccountNo: row.settle_account_no,
    settleAccountHolder: row.settle_account_holder,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
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
    async listTalkPosts({ limit = 20, offset = 0 } = {}) {
      const result = await pool.query(
        `SELECT *
         FROM talk_posts
         WHERE status = 'ACTIVE'
         ORDER BY created_at DESC, id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return result.rows.map(toTalkPost);
    },

    async countTalkPosts() {
      const result = await pool.query("SELECT count(*)::int AS count FROM talk_posts WHERE status = 'ACTIVE'");
      return Number(result.rows[0]?.count || 0);
    },

    async findTalkPostById(id) {
      const result = await pool.query("SELECT * FROM talk_posts WHERE id = $1 AND status = 'ACTIVE'", [id]);
      return toTalkPost(result.rows[0]);
    },

    async createTalkPost(post) {
      const result = await pool.query(
        `INSERT INTO talk_posts (
           user_id, franchise_id, franchise_name, title, body, price, image_url, image_urls
         )
         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8::jsonb)
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

    async findOrCreateTalkChat({ postId, sellerUserId, buyerUserId }) {
      const result = await pool.query(
        `INSERT INTO talk_chats (post_id, seller_user_id, buyer_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id, buyer_user_id)
         DO UPDATE SET updated_at = talk_chats.updated_at
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
         WHERE c.id = $1 AND (c.seller_user_id = $2 OR c.buyer_user_id = $2)`,
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
                lm.created_at AS last_message_at
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
         WHERE c.seller_user_id = $1 OR c.buyer_user_id = $1
         ORDER BY COALESCE(lm.created_at, c.updated_at) DESC`,
        [userId]
      );
      return result.rows.map(toTalkChat);
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
        await client.query('UPDATE talk_chats SET updated_at = now() WHERE id = $1', [chatId]);
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

    async findUserById(id) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return toUser(result.rows[0]);
    },

    async findUserByFranchiseId(franchiseId) {
      const result = await pool.query('SELECT * FROM users WHERE franchise_id = $1', [franchiseId]);
      return toUser(result.rows[0]);
    },

    async findAgencyById(agencyId) {
      const result = await pool.query(
        `SELECT id, type, parent_id, name, address, login_id, password_hash, owner, phone, fee_rate, join_code,
                contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at
         FROM agencies
         WHERE id = $1`,
        [agencyId]
      );
      return toAgency(result.rows[0]);
    },

    async findAgencyByLoginId(loginId) {
      const result = await pool.query(
        `SELECT id, type, parent_id, name, address, login_id, password_hash, owner, phone, fee_rate, join_code,
                contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at
         FROM agencies
         WHERE login_id = $1 OR join_code = $1`,
        [loginId]
      );
      return toAgency(result.rows[0]);
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

    async listUnreadNotifications(userId) {
      const result = await pool.query(
        `SELECT * FROM notifications
         WHERE user_id = $1 AND read_at IS NULL
         ORDER BY created_at ASC`,
        [userId]
      );
      return result.rows.map(toNotification);
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

    async createUser(user) {
      const result = await pool.query(
        `INSERT INTO users (
          email, password_hash, name, franchise_name, role, balance,
          phone, address, tel, business_number, agency_id, biz_doc_file_key, pos_file_key
        )
        VALUES ($1, $2, $3, $4, 'OWNER', 0, $5, $6, $7, $8, $9, $10, $11)
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
          user.posFileKey || null
        ]
      );
      return toUser(result.rows[0]);
    },

    async upsertAdminUser(user) {
      const result = await pool.query(
        `INSERT INTO users (
           email, password_hash, name, role, balance,
           franchise_name, phone, address, tel, business_number,
           customer_id, agency_id, biz_doc_file_key
         )
         VALUES ($1, $2, $3, 'ADMIN', 0, $3, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
         ON CONFLICT (email)
         DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = 'ADMIN',
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
        [user.email, user.passwordHash, user.name]
      );
      const updated = await pool.query(
        'UPDATE users SET franchise_id = id, franchise_name = name, updated_at = now() WHERE id = $1 RETURNING *',
        [result.rows[0].id]
      );
      return toUser(updated.rows[0]);
    },

    async listFranchiseUsers() {
      const result = await pool.query(
        `SELECT users.*, agencies.name AS agency_name
         FROM users
         LEFT JOIN agencies ON agencies.id = users.agency_id
         WHERE users.role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
         ORDER BY users.created_at DESC`
      );
      return result.rows.map(toUser);
    },

    async listAgencies() {
      const result = await pool.query(
        'SELECT id, type, parent_id, name, address, login_id, owner, phone, fee_rate, join_code, contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at FROM agencies ORDER BY created_at DESC'
      );
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        joinCode: row.join_code,
        contractFileKey: row.contract_file_key,
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
           INSERT INTO agencies (type, parent_id, name, address, login_id, owner, phone, fee_rate, join_code)
           SELECT 'HQ', NULL, $2, '', 'eatspay-hq', 'Eats Pay Admin', '', 0, $1
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
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
        joinCode: row.join_code
      };
    },

    async updateUserRoleByEmail(email, role) {
      const result = await pool.query(
        'UPDATE users SET role = $2, updated_at = now() WHERE email = $1 RETURNING *',
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
      const updates = [
        'franchise_name = $2',
        'name = $3',
        'phone = $4',
        "business_number = NULLIF($5, '')",
        'tel = COALESCE($6, tel)',
        'address = COALESCE($7, address)'
      ];
      const params = [
        franchiseId,
        fields.franchiseName,
        fields.ownerName,
        fields.phone,
        fields.businessNumber,
        fields.tel || null,
        fields.address || null
      ];
      if (fields.email !== undefined) {
        params.push(fields.email);
        updates.push(`email = $${params.length}`);
      }
      if (fields.passwordHash !== undefined) {
        params.push(fields.passwordHash);
        updates.push(`password_hash = $${params.length}`);
      }
      if (fields.agencyId !== undefined) {
        params.push(fields.agencyId);
        updates.push(`agency_id = $${params.length}`);
      }
      const result = await pool.query(
        `UPDATE users
         SET ${updates.join(', ')},
             updated_at = now()
         WHERE franchise_id = $1
           AND role IN ('OWNER', 'OWNER_PENDING', 'OWNER_REJECTED')
         RETURNING *`,
        params
      );
      return toUser(result.rows[0]);
    },

    async deleteFranchiseById(franchiseId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
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
        await client.query('DELETE FROM account_requests WHERE franchise_id = $1', [franchiseId]);
        await client.query('DELETE FROM delivery_accounts WHERE franchise_id = $1', [franchiseId]);
        await client.query('DELETE FROM transactions WHERE franchise_id = $1', [franchiseId]);
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
           type, parent_id, name, address, login_id, owner, phone, fee_rate, join_code
         )
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9)
         RETURNING id, type, parent_id, name, address, login_id, owner, phone, fee_rate, join_code,
                   contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at`,
        [
          agency.type || 'AGENCY',
          agency.parentId || null,
          agency.name,
          agency.address || null,
          agency.loginId || null,
          agency.owner || null,
          agency.phone || null,
          agency.feeRate || 0,
          agency.joinCode || null
        ]
      );
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
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
             parent_id = $3,
             name = $4,
             address = $5,
             login_id = NULLIF($6, ''),
             owner = $7,
             phone = $8,
             fee_rate = $9,
             updated_at = now()
         WHERE id = $1
         RETURNING id, type, parent_id, name, address, login_id, owner, phone, fee_rate, join_code,
                   contract_file_key, settle_bank_name, settle_account_no, settle_account_holder, created_at`,
        [
          agencyId,
          agency.type || 'AGENCY',
          agency.parentId || null,
          agency.name,
          agency.address || null,
          agency.loginId || null,
          agency.owner || null,
          agency.phone || null,
          agency.feeRate || 0
        ]
      );
      return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        name: row.name,
        address: row.address,
        loginId: row.login_id,
        owner: row.owner,
        phone: row.phone,
        feeRate: Number(row.fee_rate || 0),
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
      const result = await pool.query(
        'DELETE FROM agencies WHERE id = $1 RETURNING id, name',
        [agencyId]
      );
      return result.rows[0] || null;
    },

    async registerCard(userId, card) {
      const result = await pool.query(
        `INSERT INTO cards (id, user_id, masked_number, card_name, card_company, alias)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, masked_number, card_name, card_company, alias, created_at`,
        [card.id, userId, card.maskedNumber, card.cardName, card.cardCompany || null, card.alias]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      };
    },

    async countCardsByUserId(userId) {
      const result = await pool.query('SELECT count(*)::int AS count FROM cards WHERE user_id = $1', [userId]);
      return result.rows[0]?.count || 0;
    },

    async listCardsByUserId(userId) {
      const result = await pool.query(
        'SELECT id, masked_number, card_name, card_company, alias, created_at FROM cards WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return result.rows.map(row => ({
        id: row.id,
        maskedNumber: row.masked_number,
        cardName: row.card_name,
        cardCompany: row.card_company,
        alias: row.alias,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
      }));
    },

    async updateCardByUserId(cardId, userId, data) {
      const result = await pool.query(
        `UPDATE cards
         SET masked_number = COALESCE($3, masked_number),
             card_name = COALESCE($4, card_name),
             card_company = COALESCE($5, card_company),
             alias = COALESCE($6, alias)
         WHERE id = $1 AND user_id = $2
         RETURNING id, masked_number, card_name, card_company, alias, created_at`,
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

    async findFileByKey(fileKey) {
      const result = await pool.query('SELECT * FROM stored_files WHERE file_key = $1', [fileKey]);
      return toStoredFile(result.rows[0]);
    },

    async addDeliveryAccount(account) {
      const result = await pool.query(
        `INSERT INTO delivery_accounts (
          franchise_id, agency_id, agency_name, bank_name, account_holder, account_no, file_key, account_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
        RETURNING *`,
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

    async listDeliveryAccounts() {
      const result = await pool.query('SELECT * FROM delivery_accounts ORDER BY req_date DESC');
      return result.rows.map(toDeliveryAccount);
    },

    async listDeliveryAccountsByFranchise(franchiseId) {
      const result = await pool.query(
        'SELECT * FROM delivery_accounts WHERE franchise_id = $1 ORDER BY req_date DESC',
        [franchiseId]
      );
      return result.rows.map(toDeliveryAccount);
    },

    async countAccountsByFranchise(franchiseId) {
      const result = await pool.query(
        `SELECT
          (SELECT count(*)::int FROM account_requests WHERE franchise_id = $1) +
          (SELECT count(*)::int FROM delivery_accounts WHERE franchise_id = $1) AS total`,
        [franchiseId]
      );
      return Number(result.rows[0]?.total || 0);
    },

    async deleteDeliveryAccountByFranchise(id, franchiseId) {
      const result = await pool.query(
        'DELETE FROM delivery_accounts WHERE id = $1 AND franchise_id = $2 RETURNING *',
        [id, franchiseId]
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

    async deleteDeliveryAccount(id) {
      const result = await pool.query(
        'DELETE FROM delivery_accounts WHERE id = $1 RETURNING *',
        [id]
      );
      return toDeliveryAccount(result.rows[0]);
    },

    async listDeliveryAgencies() {
      const result = await pool.query(
        "SELECT id, name, status, sort_order, created_at, updated_at FROM delivery_agencies WHERE status <> 'deleted' ORDER BY sort_order ASC, name ASC"
      );
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        status: row.status,
        sortOrder: row.sort_order,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      }));
    },

    async createDeliveryAgency(name, status = 'active', sortOrder = 0) {
      const result = await pool.query(
        `INSERT INTO delivery_agencies (name, status, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET
           status = EXCLUDED.status,
           sort_order = EXCLUDED.sort_order,
           updated_at = now()
         RETURNING id, name, status, sort_order, created_at, updated_at`,
        [name, status, sortOrder]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
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
         RETURNING id, name, status, sort_order, created_at, updated_at`,
        [id, status]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
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

    async listInterestFreeInstallments({ onlyActive = false } = {}) {
      const result = await pool.query(
        `SELECT card_company, months, active, display_order, updated_at
         FROM interest_free_installments
         ${onlyActive ? 'WHERE active = true AND cardinality(months) > 0' : ''}
         ORDER BY display_order ASC, card_company ASC`
      );
      return result.rows.map(row => ({
        cardCompany: row.card_company,
        months: Array.isArray(row.months) ? row.months.map(Number).sort((a, b) => a - b) : [],
        active: row.active,
        displayOrder: Number(row.display_order || 0),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
      }));
    },

    async replaceInterestFreeInstallments(items) {
      const normalized = Array.isArray(items) ? items : [];
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
            `INSERT INTO interest_free_installments (card_company, months, active, display_order, updated_at)
             VALUES ($1, $2::int[], $3, $4, now())
             ON CONFLICT (card_company) DO UPDATE SET
               months = EXCLUDED.months,
               active = EXCLUDED.active,
               display_order = EXCLUDED.display_order,
               updated_at = now()`,
            [
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
      return this.listInterestFreeInstallments();
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

    async listAccountRequests() {
      const result = await pool.query('SELECT * FROM account_requests ORDER BY submitted_at DESC');
      return result.rows.map(toAccountRequest);
    },

    async listAccountRequestsByFranchise(franchiseId) {
      const result = await pool.query(
        'SELECT * FROM account_requests WHERE franchise_id = $1 ORDER BY submitted_at DESC',
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

    async recordCharge(charge) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          'UPDATE users SET balance = balance + $2, updated_at = now() WHERE id = $1 RETURNING balance',
          [charge.userId, charge.amount]
        );
        await client.query(
          `INSERT INTO transactions (
            transaction_id, franchise_id, type, amount, fee, total_amount,
            method, card_details, status
          )
          VALUES ($1, $2, 'CHARGE', $3, $4, $5, $6, $7, 'SUCCESS')`,
          [
            charge.transactionId,
            charge.franchiseId,
            charge.amount,
            charge.fee,
            charge.totalAmount,
            charge.method,
            charge.cardDetails
          ]
        );
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

    async listAgencyTransactions(filters) {
      const params = [filters.startDate, filters.endDate, filters.agencyId];
      const items = await pool.query(
        `SELECT
           transactions.*,
           users.franchise_name,
           users.agency_id,
           agencies.name AS agency_name,
           agencies.fee_rate AS agency_fee_rate
         FROM transactions
         JOIN users ON users.franchise_id = transactions.franchise_id
         LEFT JOIN agencies ON agencies.id = users.agency_id
         WHERE transactions.created_at::date BETWEEN $1::date AND $2::date
           AND users.agency_id = $3
         ORDER BY transactions.created_at DESC
         LIMIT $4 OFFSET $5`,
        [...params, filters.limit || 100, filters.offset || 0]
      );
      const count = await pool.query(
        `SELECT count(*)::int AS count
         FROM transactions
         JOIN users ON users.franchise_id = transactions.franchise_id
         WHERE transactions.created_at::date BETWEEN $1::date AND $2::date
           AND users.agency_id = $3`,
        params
      );
      return {
        items: items.rows.map(row => ({
          ...toTransaction(row),
          franchiseName: row.franchise_name,
          agencyId: row.agency_id,
          agencyName: row.agency_name,
          agencyFeeRate: Number(row.agency_fee_rate || 0)
        })),
        totalItems: count.rows[0]?.count || 0
      };
    },

    async listPgSettlements(filters = {}) {
      const whereParts = [];
      const params = [];
      if (filters.startDate) {
        params.push(filters.startDate);
        whereParts.push(`settled_at::date >= $${params.length}::date`);
      }
      if (filters.endDate) {
        params.push(filters.endDate);
        whereParts.push(`settled_at::date <= $${params.length}::date`);
      }
      if (filters.agencyId) {
        params.push(filters.agencyId);
        whereParts.push(`agency_id = $${params.length}`);
      }
      if (filters.status) {
        params.push(filters.status);
        whereParts.push(`status = $${params.length}`);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
      const limit = filters.limit || 50;
      const offset = filters.offset || 0;

      const items = await pool.query(
        `SELECT * FROM pg_settlements
         ${where}
         ORDER BY settled_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const count = await pool.query(`SELECT count(*)::int AS count FROM pg_settlements ${where}`, params);
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
