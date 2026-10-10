/**
 * Initial migration — codifies the indexes implied by the Mongoose models.
 *
 * Each index is tied to an actual query in the controllers:
 *
 *  - users.email (unique)
 *      User.findOne({ email }) — authController.signup (line 9) and
 *      authController.login (line 54). The schema already declares
 *      `email: { unique: true }`, so Mongoose auto-builds this index as
 *      `email_1` on first connect. We reuse the same name so this migration
 *      is a harmless no-op where that index already exists (explicit > implicit).
 *
 *  - conversations { userId: 1, isActive: 1, updatedAt: -1 }
 *      chatController.getConversations (line 46) filters
 *      `{ userId: req.userId, isActive: true }` and sorts `{ updatedAt: -1 }` —
 *      this compound index serves both the equality predicates and the sort.
 *      The { _id, userId } findOne queries elsewhere are covered by _id.
 *
 *  - messages { conversationId: 1, timestamp: 1 }
 *      chatController.getConversation (line 71) filters by conversationId and
 *      sorts `{ timestamp: 1 }`; the conversationId prefix also serves
 *      Message.deleteMany({ conversationId }) in hardDeleteConversation.
 */
module.exports = {
  async up(db /*, client */) {
    await db.collection('users').createIndex(
      { email: 1 },
      { unique: true, name: 'email_1' }
    );

    await db.collection('conversations').createIndex(
      { userId: 1, isActive: 1, updatedAt: -1 },
      { name: 'userId_1_isActive_1_updatedAt_-1' }
    );

    await db.collection('messages').createIndex(
      { conversationId: 1, timestamp: 1 },
      { name: 'conversationId_1_timestamp_1' }
    );
  },

  async down(db /*, client */) {
    // Drop by explicit name; ignore "index/namespace not found" so `down`
    // stays idempotent even on a partially-migrated or fresh database.
    const drops = [
      ['users', 'email_1'],
      ['conversations', 'userId_1_isActive_1_updatedAt_-1'],
      ['messages', 'conversationId_1_timestamp_1']
    ];

    for (const [collection, indexName] of drops) {
      try {
        await db.collection(collection).dropIndex(indexName);
      } catch (err) {
        const notFound =
          err.code === 27 || err.codeName === 'IndexNotFound' || // index missing
          err.code === 26 || err.codeName === 'NamespaceNotFound'; // collection missing
        if (!notFound) throw err;
      }
    }
  }
};
