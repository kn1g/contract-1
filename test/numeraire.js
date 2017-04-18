function rpc(method, arg) {
    var req = {
        jsonrpc: "2.0",
        method: method,
        id: new Date().getTime()
    };
    if (arg) req.params = arg;

    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync(req, (err, result) => {
            if (err) return reject(err)
            if (result && result.error) {
                return reject(new Error("RPC Error: " + (result.error.message || result.error)))
            }
            resolve(result)
        })
    })
}

// Change block time using the rpc call "evm_setTimestamp"
// https://github.com/ethereumjs/testrpc/issues/47
web3.evm = web3.evm || {}
web3.evm.increaseTime = function(time) {
    return rpc('evm_increaseTime', [time])
}

function checkAllGasSpent(gasAmount, gasPrice, account, prevBalance) {
    var newBalance = web3.eth.getBalance(account);
    assert.equal(prevBalance.minus(newBalance).toNumber(), gasAmount * gasPrice, 'Incorrect amount of gas used');
}

function ifUsingTestRPC() {
    return;
}

//Some default values for gas
var gasAmount = 3000000;
var gasPrice = 20000000000;

var Numeraire = artifacts.require("./NumeraireBackend.sol");
var NumeraireDelegate = artifacts.require("./NumeraireDelegate.sol");

contract('Numeraire', function(accounts) {

    before(function() {
        Numeraire.deployed().then(function(nmrInstance) {
            NumeraireDelegate.deployed().then(function(delegateInstance) {
                nmrInstance.changeDelegate(delegateInstance.address, {from: accounts[0]})
            })
        })
    })

    it ("should set the delegate correctly", function(done) {
        Numeraire.deployed().then(function(nmrInstance) {
            NumeraireDelegate.deployed().then(function(delegateInstance) {
                nmrInstance.delegateContract.call().then(function(delegateAddress) {
                    assert.equal(delegateAddress, delegateInstance.address)
                    done()
                })
            })
        })
    })

    it("should set disbursement on creation", function(done) {
        Numeraire.deployed().then(function(nmrInstance) {
            nmrInstance.disbursement.call().then(function(disbursement) {
                assert.equal(disbursement.toNumber(), 1500000000000000000000000)
                done()
            })
        })
    })

    it("should mint correctly", function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            instance.mint(10000000000, {from: accounts[0]}).then(function() {
                instance.balanceOf.call(instance.address).then(function(balance) {
                    // check if Numerai has minted amount
                    assert.equal(balance.toNumber(), 10000000000)
                    done()
                })
            })
        })
    })

    it("should increment totalSupply on mint", function(done) {
        Numeraire.deployed().then(function(instance) {
            instance.totalSupply.call().then(function(supply) {
                // check if supply has increased by minted amounts
                assert.equal(supply.toNumber(), 10000000000)
                done()
            })
        })
    })

    it('should reduce disbursement when minting', function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            return instance.disbursement.call().then(function(last_disbursement) {
                return instance.mint(10000000000, {
                    from: accounts[0]
                }).then(function() {
                    instance.disbursement.call().then(function(disbursement) {
                        assert.equal(disbursement.toNumber(), last_disbursement.toNumber() - 10000000000);
                        done();
                    });
                });
            });
        });
    });

    it("should reset disbursement once per week", function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            return instance.disbursement.call().then(disbursement => {
                return instance.mint(500000, {
                    from: accounts[0]
                }).then(() => {
                    return web3.evm.increaseTime(7 * 25 * 60 * 60).then(() => {
                        return instance.mint(20000000000, {
                            from: accounts[0]
                        }).then(() => {
                            return instance.disbursement.call().then(disbursement => {
                                assert.equal(96153846153846153846153 - 20000000000, disbursement.toNumber());
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    it("should send NMR correctly from numerai account", function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            // Get initial balances of first and second account.
            var account_one = Numeraire.address;
            var account_two = accounts[2];

            var account_one_starting_balance;
            var account_two_starting_balance;
            var account_one_ending_balance;
            var account_two_ending_balance;

            var amount = 1000000000;

            return instance.mint(amount, {
                from: accounts[0]
            }).then(function() {
                return instance.balanceOf.call(account_one).then(function(balance) {
                    account_one_starting_balance = balance.toNumber();
                    return instance.balanceOf.call(account_two);
                }).then(function(balance) {
                    account_two_starting_balance = balance.toNumber();
                    instance.numeraiTransfer(account_two, amount, {
                        from: accounts[0]
                    });
                }).then(function() {
                    return instance.balanceOf.call(account_one);
                }).then(function(balance) {
                    account_one_ending_balance = balance.toNumber();
                    return instance.balanceOf.call(account_two);
                }).then(function(balance) {
                    account_two_ending_balance = balance.toNumber();

                    assert.equal(account_one_ending_balance, account_one_starting_balance - amount, "Amount wasn't correctly taken from the sender");
                    assert.equal(account_two_ending_balance, account_two_starting_balance + amount, "Amount wasn't correctly sent to the receiver");
                    done();
                });
            });
        });
    });

    it('should stake NMR', (done) => {
        var submissionID = '0x2953a031a0e3f018886fbf6b1eaa044f9e2980476e207ea50087b0a3e32d7a30'
        numerai_hot_wallet = accounts[2]
        var nmr = Numeraire.deployed().then(function(instance) {
            return instance.balanceOf.call(numerai_hot_wallet)
                .then(() => instance.balanceOf.call(numerai_hot_wallet).then((balance) => {
                    return instance.stake(numerai_hot_wallet, submissionID, 500, {
                        from: accounts[0]
                    }).then(() => {
                        // TODO: Add stakeOf
                        // TODO: Add instance.staked.call
                        // check if stakers balance has been reduced
                        return instance.balanceOf.call(numerai_hot_wallet).then((balance_after) => {
                            assert.equal(balance.toNumber() - 500, balance_after.toNumber());
                            done();
                        });
                    });
                }));
        });
    });

});

// TODO: Calling mint, stake, transferNumerai, resolveStake, destroyStake from any address but the NumeraireBackend fails
// TODO: Calling mint, stake, transferNumerai, resolveStake, destroyStake from NumeraireBackend succeeds
