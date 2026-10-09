/**
 * Factories that produce jest-mocked versions of the mongoose models.
 * Kept in a module with no route/model requires so jest.mock() factories can
 * safely `require('./mockFactories')` without circular-dependency issues.
 *
 * Each mock doubles as a constructor (`new Model(data)` returns a document
 * with a mocked .save()) and exposes mocked static query methods that tests
 * configure per-case.
 */
function makeUserModel() {
  const MockUser = jest.fn().mockImplementation((data = {}) => ({
    _id: 'user-1',
    verified: true,
    ...data,
    save: jest.fn().mockResolvedValue(true)
  }));
  MockUser.findOne = jest.fn();
  MockUser.findById = jest.fn();
  return MockUser;
}

function makeConversationModel() {
  const MockConversation = jest.fn().mockImplementation((data = {}) => ({
    _id: 'conv-1',
    isActive: true,
    title: 'New Conversation',
    ...data,
    save: jest.fn().mockResolvedValue(true)
  }));
  MockConversation.find = jest.fn();
  MockConversation.findOne = jest.fn();
  MockConversation.findById = jest.fn();
  MockConversation.deleteOne = jest.fn();
  return MockConversation;
}

function makeMessageModel() {
  const MockMessage = jest.fn().mockImplementation((data = {}) => ({
    _id: 'msg-1',
    ...data,
    save: jest.fn().mockResolvedValue(true)
  }));
  MockMessage.find = jest.fn();
  MockMessage.findOne = jest.fn();
  MockMessage.create = jest.fn();
  MockMessage.deleteMany = jest.fn();
  return MockMessage;
}

module.exports = { makeUserModel, makeConversationModel, makeMessageModel };
